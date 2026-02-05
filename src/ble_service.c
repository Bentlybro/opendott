/*
 * OpenDOTT - BLE Service
 * SPDX-License-Identifier: MIT
 * 
 * Custom BLE GATT service for image transfer
 */

#include <zephyr/kernel.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/logging/log.h>

#include "opendott.h"

LOG_MODULE_REGISTER(ble_service, CONFIG_LOG_DEFAULT_LEVEL);

/*
 * BLE Service UUIDs - Based on reverse engineering of original DOTT
 * 
 * The original uses multiple services:
 * - 0xFFF0 with FFF1 (notify) and FFF2 (write)
 * - f000ffe0-0451-4000-b000-000000000000 (TI-style)
 * - MCUmgr SMP: 8d53dc1d-1db7-4cd3-868b-8a527460aa84
 * 
 * For OpenDOTT, we use the TI-style service for compatibility
 */

/* Primary Service UUID: f000ffe0-0451-4000-b000-000000000000 */
#define BT_UUID_OPENDOTT_SERVICE_VAL \
    BT_UUID_128_ENCODE(0xf000ffe0, 0x0451, 0x4000, 0xb000, 0x000000000000)

/* Write Characteristic: f000ffe1-0451-4000-b000-000000000000 */
#define BT_UUID_OPENDOTT_IMAGE_DATA_VAL \
    BT_UUID_128_ENCODE(0xf000ffe1, 0x0451, 0x4000, 0xb000, 0x000000000000)

/* Notify Characteristic: f000ffe2-0451-4000-b000-000000000000 */
#define BT_UUID_OPENDOTT_TRANSFER_CTRL_VAL \
    BT_UUID_128_ENCODE(0xf000ffe2, 0x0451, 0x4000, 0xb000, 0x000000000000)

/* Also expose the short UUID service 0xFFF0 for compatibility */
#define BT_UUID_OPENDOTT_SHORT_SERVICE_VAL BT_UUID_16_ENCODE(0xFFF0)
#define BT_UUID_OPENDOTT_SHORT_NOTIFY_VAL  BT_UUID_16_ENCODE(0xFFF1)
#define BT_UUID_OPENDOTT_SHORT_WRITE_VAL   BT_UUID_16_ENCODE(0xFFF2)

/* Device Info uses standard UUID */
#define BT_UUID_OPENDOTT_DEVICE_INFO_VAL \
    BT_UUID_128_ENCODE(0xf000ffe3, 0x0451, 0x4000, 0xb000, 0x000000000000)

static struct bt_uuid_128 service_uuid = BT_UUID_INIT_128(BT_UUID_OPENDOTT_SERVICE_VAL);
static struct bt_uuid_128 image_data_uuid = BT_UUID_INIT_128(BT_UUID_OPENDOTT_IMAGE_DATA_VAL);
static struct bt_uuid_128 transfer_ctrl_uuid = BT_UUID_INIT_128(BT_UUID_OPENDOTT_TRANSFER_CTRL_VAL);
static struct bt_uuid_128 device_info_uuid = BT_UUID_INIT_128(BT_UUID_OPENDOTT_DEVICE_INFO_VAL);

/* Connection state */
static struct bt_conn *current_conn = NULL;
static transfer_callback_t transfer_cb = NULL;

/* Transfer state */
static struct {
    uint8_t *buffer;
    size_t expected_size;
    size_t received_size;
    transfer_state_t state;
} transfer = {0};

/* Advertising data */
static const struct bt_data ad[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
    BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME, sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

static const struct bt_data sd[] = {
    BT_DATA_BYTES(BT_DATA_UUID128_ALL, BT_UUID_OPENDOTT_SERVICE_VAL),
};

/* Forward declarations */
static void connected(struct bt_conn *conn, uint8_t err);
static void disconnected(struct bt_conn *conn, uint8_t reason);
static ssize_t write_image_data(struct bt_conn *conn,
                                 const struct bt_gatt_attr *attr,
                                 const void *buf, uint16_t len,
                                 uint16_t offset, uint8_t flags);
static ssize_t write_transfer_ctrl(struct bt_conn *conn,
                                    const struct bt_gatt_attr *attr,
                                    const void *buf, uint16_t len,
                                    uint16_t offset, uint8_t flags);
static ssize_t read_device_info(struct bt_conn *conn,
                                 const struct bt_gatt_attr *attr,
                                 void *buf, uint16_t len, uint16_t offset);

/* Connection callbacks */
BT_CONN_CB_DEFINE(conn_callbacks) = {
    .connected = connected,
    .disconnected = disconnected,
};

/* GATT service definition */
BT_GATT_SERVICE_DEFINE(opendott_svc,
    BT_GATT_PRIMARY_SERVICE(&service_uuid),

    /* Image Data Characteristic - Write without response for speed */
    BT_GATT_CHARACTERISTIC(&image_data_uuid.uuid,
                          BT_GATT_CHRC_WRITE_WITHOUT_RESP,
                          BT_GATT_PERM_WRITE,
                          NULL, write_image_data, NULL),

    /* Transfer Control Characteristic - Write + Notify */
    BT_GATT_CHARACTERISTIC(&transfer_ctrl_uuid.uuid,
                          BT_GATT_CHRC_WRITE | BT_GATT_CHRC_NOTIFY,
                          BT_GATT_PERM_WRITE,
                          NULL, write_transfer_ctrl, NULL),
    BT_GATT_CCC(NULL, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),

    /* Device Info Characteristic - Read */
    BT_GATT_CHARACTERISTIC(&device_info_uuid.uuid,
                          BT_GATT_CHRC_READ,
                          BT_GATT_PERM_READ,
                          read_device_info, NULL, NULL),
);

/* Connection event handlers */
static void connected(struct bt_conn *conn, uint8_t err)
{
    if (err) {
        LOG_ERR("Connection failed: %d", err);
        return;
    }

    LOG_INF("Connected");
    current_conn = bt_conn_ref(conn);
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
    LOG_INF("Disconnected (reason: 0x%02x)", reason);

    if (current_conn) {
        bt_conn_unref(current_conn);
        current_conn = NULL;
    }

    /* Cancel any ongoing transfer */
    if (transfer.state == TRANSFER_IN_PROGRESS) {
        transfer.state = TRANSFER_ERROR;
        if (transfer.buffer) {
            k_free(transfer.buffer);
            transfer.buffer = NULL;
        }
    }

    /* Restart advertising */
    ble_start_advertising();
}

/* Image data write handler */
static ssize_t write_image_data(struct bt_conn *conn,
                                 const struct bt_gatt_attr *attr,
                                 const void *buf, uint16_t len,
                                 uint16_t offset, uint8_t flags)
{
    if (transfer.state != TRANSFER_IN_PROGRESS) {
        LOG_WRN("Received data but no transfer in progress");
        return BT_GATT_ERR(BT_ATT_ERR_WRITE_NOT_PERMITTED);
    }

    if (!transfer.buffer) {
        LOG_ERR("Transfer buffer not allocated");
        return BT_GATT_ERR(BT_ATT_ERR_INSUFFICIENT_RESOURCES);
    }

    /* Check bounds */
    if (transfer.received_size + len > transfer.expected_size) {
        LOG_ERR("Transfer overflow: %zu + %u > %zu",
                transfer.received_size, len, transfer.expected_size);
        return BT_GATT_ERR(BT_ATT_ERR_INVALID_OFFSET);
    }

    /* Copy data */
    memcpy(transfer.buffer + transfer.received_size, buf, len);
    transfer.received_size += len;

    /* Progress callback */
    if (transfer_cb) {
        int progress = (transfer.received_size * 100) / transfer.expected_size;
        transfer_cb(TRANSFER_IN_PROGRESS, progress);
    }

    /* Check if complete */
    if (transfer.received_size >= transfer.expected_size) {
        LOG_INF("Transfer complete: %zu bytes", transfer.received_size);
        process_transfer();
    }

    return len;
}

/* Transfer control commands */
#define CMD_START_TRANSFER  0x01
#define CMD_CANCEL_TRANSFER 0x02
#define CMD_GET_STATUS      0x03

static ssize_t write_transfer_ctrl(struct bt_conn *conn,
                                    const struct bt_gatt_attr *attr,
                                    const void *buf, uint16_t len,
                                    uint16_t offset, uint8_t flags)
{
    const uint8_t *data = buf;

    if (len < 1) {
        return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
    }

    uint8_t cmd = data[0];

    switch (cmd) {
    case CMD_START_TRANSFER:
        if (len < 5) {
            LOG_ERR("Start transfer command too short");
            return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
        }

        /* Extract expected size (4 bytes, little-endian) */
        uint32_t size = data[1] | (data[2] << 8) | 
                        (data[3] << 16) | (data[4] << 24);

        LOG_INF("Starting transfer, expected size: %u bytes", size);

        /* Validate size */
        if (size == 0 || size > MAX_IMAGE_SIZE) {
            LOG_ERR("Invalid transfer size: %u", size);
            return BT_GATT_ERR(BT_ATT_ERR_VALUE_NOT_ALLOWED);
        }

        /* Allocate buffer */
        if (transfer.buffer) {
            k_free(transfer.buffer);
        }
        transfer.buffer = k_malloc(size);
        if (!transfer.buffer) {
            LOG_ERR("Failed to allocate transfer buffer");
            return BT_GATT_ERR(BT_ATT_ERR_INSUFFICIENT_RESOURCES);
        }

        transfer.expected_size = size;
        transfer.received_size = 0;
        transfer.state = TRANSFER_IN_PROGRESS;
        break;

    case CMD_CANCEL_TRANSFER:
        LOG_INF("Transfer cancelled");
        if (transfer.buffer) {
            k_free(transfer.buffer);
            transfer.buffer = NULL;
        }
        transfer.state = TRANSFER_IDLE;
        break;

    case CMD_GET_STATUS:
        /* TODO: Send status notification */
        break;

    default:
        LOG_WRN("Unknown command: 0x%02x", cmd);
        return BT_GATT_ERR(BT_ATT_ERR_NOT_SUPPORTED);
    }

    return len;
}

/* Device info read handler */
static ssize_t read_device_info(struct bt_conn *conn,
                                 const struct bt_gatt_attr *attr,
                                 void *buf, uint16_t len, uint16_t offset)
{
    /* Simple info structure */
    struct {
        uint8_t version_major;
        uint8_t version_minor;
        uint8_t version_patch;
        uint8_t battery_percent;  /* TODO: Implement battery reading */
        uint32_t free_space;
    } __packed info = {
        .version_major = OPENDOTT_VERSION_MAJOR,
        .version_minor = OPENDOTT_VERSION_MINOR,
        .version_patch = OPENDOTT_VERSION_PATCH,
        .battery_percent = 100,  /* Placeholder */
        .free_space = 0,
    };

    size_t free_bytes;
    if (storage_get_free_space(&free_bytes) == 0) {
        info.free_space = (uint32_t)free_bytes;
    }

    return bt_gatt_attr_read(conn, attr, buf, len, offset, &info, sizeof(info));
}

/* Process completed transfer */
static void process_transfer(void)
{
    transfer.state = TRANSFER_COMPLETE;

    /* CRITICAL: Validate the image BEFORE saving */
    if (!image_validate(transfer.buffer, transfer.received_size)) {
        LOG_ERR("Image validation FAILED - rejecting transfer");
        LOG_ERR("This is how you avoid bricking devices.");

        transfer.state = TRANSFER_ERROR;
        if (transfer_cb) {
            transfer_cb(TRANSFER_ERROR, 0);
        }
    } else {
        LOG_INF("Image validated successfully");

        /* Save to storage */
        int ret = storage_save_image(transfer.buffer, transfer.received_size, "current.img");
        if (ret < 0) {
            LOG_ERR("Failed to save image: %d", ret);
            transfer.state = TRANSFER_ERROR;
        } else {
            /* Display the new image */
            ret = image_decode_and_display(transfer.buffer, transfer.received_size);
            if (ret < 0) {
                LOG_ERR("Failed to display image: %d", ret);
            }
        }

        if (transfer_cb) {
            transfer_cb(transfer.state, 100);
        }
    }

    /* Free buffer */
    if (transfer.buffer) {
        k_free(transfer.buffer);
        transfer.buffer = NULL;
    }
}

/* Public API */
int ble_service_init(void)
{
    int ret = bt_enable(NULL);
    if (ret) {
        LOG_ERR("Bluetooth enable failed: %d", ret);
        return ret;
    }

    LOG_INF("Bluetooth initialized");
    return 0;
}

int ble_start_advertising(void)
{
    int ret = bt_le_adv_start(BT_LE_ADV_CONN, ad, ARRAY_SIZE(ad),
                              sd, ARRAY_SIZE(sd));
    if (ret) {
        LOG_ERR("Advertising start failed: %d", ret);
        return ret;
    }

    LOG_INF("Advertising started as '%s'", CONFIG_BT_DEVICE_NAME);
    return 0;
}

int ble_stop_advertising(void)
{
    return bt_le_adv_stop();
}

bool ble_is_connected(void)
{
    return current_conn != NULL;
}

void ble_set_transfer_callback(transfer_callback_t callback)
{
    transfer_cb = callback;
}
