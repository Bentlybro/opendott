/*
 * OpenDOTT - Storage Driver
 * SPDX-License-Identifier: MIT
 * 
 * LittleFS on GD25Q128 external flash
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/fs/fs.h>
#include <zephyr/fs/littlefs.h>
#include <zephyr/storage/flash_map.h>
#include <zephyr/logging/log.h>

#include "opendott.h"

LOG_MODULE_REGISTER(storage, CONFIG_LOG_DEFAULT_LEVEL);

/* Mount point */
#define STORAGE_MOUNT_POINT "/lfs"
#define STORAGE_PARTITION lfs_storage
#define STORAGE_PARTITION_ID FIXED_PARTITION_ID(STORAGE_PARTITION)

/* LittleFS configuration */
FS_LITTLEFS_DECLARE_DEFAULT_CONFIG(storage_lfs);

static struct fs_mount_t lfs_mount = {
    .type = FS_LITTLEFS,
    .fs_data = &storage_lfs,
    .storage_dev = (void *)STORAGE_PARTITION_ID,
    .mnt_point = STORAGE_MOUNT_POINT,
};

static bool storage_mounted = false;

int storage_init(void)
{
    int ret;

    /* Check if partition exists */
    const struct flash_area *fa;
    ret = flash_area_open(STORAGE_PARTITION_ID, &fa);
    if (ret < 0) {
        LOG_ERR("Failed to open flash area: %d", ret);
        return ret;
    }
    
    LOG_INF("Flash area: offset=0x%lx, size=%zu KB", 
            (unsigned long)fa->fa_off, fa->fa_size / 1024);
    flash_area_close(fa);

    /* Try to mount */
    ret = fs_mount(&lfs_mount);
    if (ret < 0) {
        LOG_WRN("Mount failed (%d), formatting...", ret);
        
        /* Format and retry */
        ret = fs_mkfs(FS_LITTLEFS, (uintptr_t)STORAGE_PARTITION_ID, NULL, 0);
        if (ret < 0) {
            LOG_ERR("Format failed: %d", ret);
            return ret;
        }

        ret = fs_mount(&lfs_mount);
        if (ret < 0) {
            LOG_ERR("Mount after format failed: %d", ret);
            return ret;
        }
    }

    storage_mounted = true;
    LOG_INF("Storage mounted at %s", STORAGE_MOUNT_POINT);

    return 0;
}

int storage_save_image(const uint8_t *data, size_t size, const char *name)
{
    if (!storage_mounted) {
        return -ENODEV;
    }

    if (size > MAX_IMAGE_SIZE) {
        LOG_ERR("Image too large: %zu > %d", size, MAX_IMAGE_SIZE);
        return OPENDOTT_ERR_FILE_TOO_LARGE;
    }

    char path[64];
    snprintf(path, sizeof(path), "%s/%s", STORAGE_MOUNT_POINT, name);

    struct fs_file_t file;
    fs_file_t_init(&file);

    int ret = fs_open(&file, path, FS_O_CREATE | FS_O_WRITE | FS_O_TRUNC);
    if (ret < 0) {
        LOG_ERR("Failed to open file for writing: %d", ret);
        return OPENDOTT_ERR_FLASH_WRITE;
    }

    ssize_t written = fs_write(&file, data, size);
    fs_close(&file);

    if (written != size) {
        LOG_ERR("Write incomplete: %zd != %zu", written, size);
        return OPENDOTT_ERR_FLASH_WRITE;
    }

    LOG_INF("Saved %zu bytes to %s", size, path);
    return 0;
}

int storage_load_image(const char *name, uint8_t **data, size_t *size)
{
    if (!storage_mounted) {
        return -ENODEV;
    }

    char path[64];
    snprintf(path, sizeof(path), "%s/%s", STORAGE_MOUNT_POINT, name);

    struct fs_file_t file;
    fs_file_t_init(&file);

    int ret = fs_open(&file, path, FS_O_READ);
    if (ret < 0) {
        LOG_ERR("Failed to open file for reading: %d", ret);
        return OPENDOTT_ERR_FLASH_READ;
    }

    /* Get file size */
    struct fs_dirent entry;
    ret = fs_stat(path, &entry);
    if (ret < 0) {
        fs_close(&file);
        return OPENDOTT_ERR_FLASH_READ;
    }

    *size = entry.size;

    /* Allocate buffer */
    *data = k_malloc(*size);
    if (!*data) {
        fs_close(&file);
        return OPENDOTT_ERR_NO_MEMORY;
    }

    /* Read file */
    ssize_t read = fs_read(&file, *data, *size);
    fs_close(&file);

    if (read != *size) {
        k_free(*data);
        *data = NULL;
        LOG_ERR("Read incomplete: %zd != %zu", read, *size);
        return OPENDOTT_ERR_FLASH_READ;
    }

    LOG_INF("Loaded %zu bytes from %s", *size, path);
    return 0;
}

int storage_delete_image(const char *name)
{
    if (!storage_mounted) {
        return -ENODEV;
    }

    char path[64];
    snprintf(path, sizeof(path), "%s/%s", STORAGE_MOUNT_POINT, name);

    int ret = fs_unlink(path);
    if (ret < 0) {
        LOG_ERR("Failed to delete %s: %d", path, ret);
        return ret;
    }

    LOG_INF("Deleted %s", path);
    return 0;
}

int storage_get_free_space(size_t *free_bytes)
{
    if (!storage_mounted) {
        return -ENODEV;
    }

    struct fs_statvfs stat;
    int ret = fs_statvfs(STORAGE_MOUNT_POINT, &stat);
    if (ret < 0) {
        return ret;
    }

    *free_bytes = stat.f_bfree * stat.f_bsize;
    return 0;
}

int storage_format(void)
{
    LOG_WRN("Formatting storage...");

    if (storage_mounted) {
        fs_unmount(&lfs_mount);
        storage_mounted = false;
    }

    int ret = fs_mkfs(FS_LITTLEFS, (uintptr_t)STORAGE_PARTITION_ID, NULL, 0);
    if (ret < 0) {
        LOG_ERR("Format failed: %d", ret);
        return ret;
    }

    ret = fs_mount(&lfs_mount);
    if (ret < 0) {
        LOG_ERR("Mount after format failed: %d", ret);
        return ret;
    }

    storage_mounted = true;
    LOG_INF("Storage formatted and mounted");
    return 0;
}
