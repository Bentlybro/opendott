/*
 * OpenDOTT - BLE Service
 * SPDX-License-Identifier: MIT
 * 
 * DOTT-compatible BLE GATT service for image transfer
 * Protocol reverse-engineered from official app
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
 * DOTT BLE Protocol (Reverse Engineered)
 * ======================================
 * 
 * Service UUID: 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc
 * 
 * Characteristics:
 *   0x1525 - Data      (read, write-without-response) - GIF data
 *   0x1526 - Command   (read, write)
 *   0x1527 - Status    (read, write)  
 *   0x1528 - Trigger   (read, write, indicate) - Transfer trigger
 *   0x1529 - Notify    (write, notify) - Transfer notifications
 *   0x1530 - Response  (read, notify) - Completion status
 * 
 * Upload Sequence:
 *   1. Client writes 0x00401000 to 0x1528 (trigger command)
 *   2. Device responds with indication 0xFFFFFFFF (ready)
 *   3. Client streams raw GIF bytes to 0x1525
 *   4. Device sends "Transfer Complete" notification on 0x1529
 */

/* Service UUID: 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc */
#define BT_UUID_DOTT_SERVICE_VAL \
    BT_UUID_128_ENCODE(0x0483dadd, 0x6c9d, 0x6ca9, 0x5d41, 0x03ad4fff4bcc)

/* Characteristic UUIDs (16-bit style) */
#define BT_UUID_DOTT_DATA_VAL      BT_UUID_16_ENCODE(0x1525)
#define BT_UUID_DOTT_COMMAND_VAL   BT_UUID_16_ENCODE(0x1526)
#define BT_UUID_DOTT_STATUS_VAL    BT_UUID_16_ENCODE(0x1527)
#define BT_UUID_DOTT_TRIGGER_VAL   BT_UUID_16_ENCODE(0x1528)
#define BT_UUID_DOTT_NOTIFY_VAL    BT_UUID_16_ENCODE(0x1529)
#define BT_UUID_DOTT_RESPONSE_VAL  BT_UUID_16_ENCODE(0x1530)

/* Protocol constants */
#define TRIGGER_CMD_VALUE    0x00104000  /* 0x00401000 little-endian */
#define READY_INDICATION     0xFFFFFFFF

/* GIF magic bytes */
#define GIF_MAGIC_89A        0x613938464947  /* "GIF89a" */
#define GIF_MAGIC_87A        0x613738464947  /* "GIF87a" */

static struct bt_uuid_128 service_uuid = BT_UUID_INIT_128(BT_UUID_DOTT_SERVICE_VAL);
static struct bt_uuid_16 data_uuid = BT_UUID_INIT_16(0x1525);
static struct bt_uuid_16 command_uuid = BT_UUID_INIT_16(0x1526);
static struct bt_uuid_16 status_uuid = BT_UUID_INIT_16(0x1527);
static struct bt_uuid_16 trigger_uuid = BT_UUID_INIT_16(0x1528);
static struct bt_uuid_16 notify_uuid = BT_UUID_INIT_16(0x1529);
static struct bt_uuid_16 response_uuid = BT_UUID_INIT_16(0x1530);

/* Connection state */
static struct bt_conn *current_conn = NULL;

/* CCC descriptors for notifications/indications */
static bool trigger_indicate_enabled = false;
static bool notify_enabled = false;
static bool response_notify_enabled = false;

/* Transfer state machine (transfer_state_t defined in opendott.h) */
static struct {
    transfer_state_t state;
    uint8_t *buffer;
    size_t buffer_size;
    size_t received_size;
    bool gif_valid;
} transfer = {
    .state = TRANSFER_IDLE,
    .buffer = NULL,
    .buffer_size = 0,
    .received_size = 0,
    .gif_valid = false
};

/* Advertising data */
static const struct bt_data ad[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
    BT_DATA(BT_DATA_NAME_COMPLETE, "Dott", 4),
};

static const struct bt_data sd[] = {
    BT_DATA_BYTES(BT_DATA_UUID128_ALL, BT_UUID_DOTT_SERVICE_VAL),
};

/* Forward declarations */
static ssize_t read_data(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                         void *buf, uint16_t len, uint16_t offset);
static ssize_t write_data(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                          const void *buf, uint16_t len, uint16_t offset, uint8_t flags);
static ssize_t write_trigger(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                             const void *buf, uint16_t len, uint16_t offset, uint8_t flags);
static ssize_t read_status(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                           void *buf, uint16_t len, uint16_t offset);

static void trigger_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value);
static void notify_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value);
static void response_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value);

/* GATT Service Definition */
BT_GATT_SERVICE_DEFINE(dott_svc,
    /* Primary Service */
    BT_GATT_PRIMARY_SERVICE(&service_uuid),
    
    /* 0x1525 - Data Characteristic (GIF data) */
    BT_GATT_CHARACTERISTIC(&data_uuid.uuid,
                          BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE_WITHOUT_RESP,
                          BT_GATT_PERM_READ | BT_GATT_PERM_WRITE,
                          read_data, write_data, NULL),
    
    /* 0x1526 - Command Characteristic */
    BT_GATT_CHARACTERISTIC(&command_uuid.uuid,
                          BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE,
                          BT_GATT_PERM_READ | BT_GATT_PERM_WRITE,
                          NULL, NULL, NULL),
    
    /* 0x1527 - Status Characteristic */
    BT_GATT_CHARACTERISTIC(&status_uuid.uuid,
                          BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE,
                          BT_GATT_PERM_READ | BT_GATT_PERM_WRITE,
                          read_status, NULL, NULL),
    
    /* 0x1528 - Trigger Characteristic (with indication) */
    BT_GATT_CHARACTERISTIC(&trigger_uuid.uuid,
                          BT_GATT_CHRC_READ | BT_GATT_CHRC_WRITE | BT_GATT_CHRC_INDICATE,
                          BT_GATT_PERM_READ | BT_GATT_PERM_WRITE,
                          NULL, write_trigger, NULL),
    BT_GATT_CCC(trigger_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
    
    /* 0x1529 - Notify Characteristic */
    BT_GATT_CHARACTERISTIC(&notify_uuid.uuid,
                          BT_GATT_CHRC_WRITE | BT_GATT_CHRC_NOTIFY,
                          BT_GATT_PERM_WRITE,
                          NULL, NULL, NULL),
    BT_GATT_CCC(notify_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
    
    /* 0x1530 - Response Characteristic */
    BT_GATT_CHARACTERISTIC(&response_uuid.uuid,
                          BT_GATT_CHRC_READ | BT_GATT_CHRC_NOTIFY,
                          BT_GATT_PERM_READ,
                          NULL, NULL, NULL),
    BT_GATT_CCC(response_ccc_changed, BT_GATT_PERM_READ | BT_GATT_PERM_WRITE),
);

/* Connection callbacks */
static void connected(struct bt_conn *conn, uint8_t err)
{
    if (err) {
        LOG_ERR("Connection failed (err %u)", err);
        return;
    }

    current_conn = bt_conn_ref(conn);
    LOG_INF("Connected");
    
    /* Reset transfer state */
    transfer.state = TRANSFER_IDLE;
    transfer.received_size = 0;
}

static void disconnected(struct bt_conn *conn, uint8_t reason)
{
    LOG_INF("Disconnected (reason %u)", reason);
    
    if (current_conn) {
        bt_conn_unref(current_conn);
        current_conn = NULL;
    }
    
    /* Reset transfer state */
    transfer.state = TRANSFER_IDLE;
    transfer.received_size = 0;
}

BT_CONN_CB_DEFINE(conn_callbacks) = {
    .connected = connected,
    .disconnected = disconnected,
};

/* CCC callbacks */
static void trigger_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
    trigger_indicate_enabled = (value == BT_GATT_CCC_INDICATE);
    LOG_INF("Trigger indications %s", trigger_indicate_enabled ? "enabled" : "disabled");
}

static void notify_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
    notify_enabled = (value == BT_GATT_CCC_NOTIFY);
    LOG_INF("Notify notifications %s", notify_enabled ? "enabled" : "disabled");
}

static void response_ccc_changed(const struct bt_gatt_attr *attr, uint16_t value)
{
    response_notify_enabled = (value == BT_GATT_CCC_NOTIFY);
    LOG_INF("Response notifications %s", response_notify_enabled ? "enabled" : "disabled");
}

/* Send indication on trigger characteristic (0x1528) */
static int send_trigger_indication(uint32_t value)
{
    if (!current_conn || !trigger_indicate_enabled) {
        return -ENOTCONN;
    }
    
    /* Find the trigger characteristic attribute */
    const struct bt_gatt_attr *attr = bt_gatt_find_by_uuid(
        dott_svc.attrs, dott_svc.attr_count, &trigger_uuid.uuid);
    
    if (!attr) {
        return -ENOENT;
    }
    
    return bt_gatt_indicate(current_conn, &(struct bt_gatt_indicate_params){
        .attr = attr,
        .data = &value,
        .len = sizeof(value),
    });
}

/* Send notification on notify characteristic (0x1529) */
static int send_notify(const char *message)
{
    if (!current_conn || !notify_enabled) {
        return -ENOTCONN;
    }
    
    const struct bt_gatt_attr *attr = bt_gatt_find_by_uuid(
        dott_svc.attrs, dott_svc.attr_count, &notify_uuid.uuid);
    
    if (!attr) {
        return -ENOENT;
    }
    
    return bt_gatt_notify(current_conn, attr, message, strlen(message));
}

/* Validate GIF header */
static bool validate_gif_header(const uint8_t *data, size_t len)
{
    if (len < 6) {
        return false;
    }
    
    /* Check for GIF89a or GIF87a */
    if (memcmp(data, "GIF89a", 6) == 0 || memcmp(data, "GIF87a", 6) == 0) {
        return true;
    }
    
    return false;
}

/* Read data characteristic - returns MCUboot-style status (for compatibility) */
static ssize_t read_data(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                         void *buf, uint16_t len, uint16_t offset)
{
    /* Return some status data for compatibility with original protocol */
    static uint8_t status_data[] = {0x01, 0x31, 0x00, 0x02, 0x29, 0x00};
    
    return bt_gatt_attr_read(conn, attr, buf, len, offset,
                            status_data, sizeof(status_data));
}

/* Write data characteristic - receives GIF data */
static ssize_t write_data(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                          const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
    const uint8_t *data = buf;
    
    if (transfer.state != TRANSFER_TRIGGERED && transfer.state != TRANSFER_RECEIVING) {
        LOG_WRN("Data received but not in receive mode (state=%d)", transfer.state);
        return len;  /* Accept but ignore */
    }
    
    /* First chunk - validate GIF header */
    if (transfer.received_size == 0) {
        if (!validate_gif_header(data, len)) {
            LOG_ERR("Invalid GIF header");
            transfer.state = TRANSFER_FAILED;
            send_notify("Transfer Fail");
            return len;
        }
        transfer.gif_valid = true;
        transfer.state = TRANSFER_RECEIVING;
        LOG_INF("GIF header valid, receiving data...");
    }
    
    /* Store data (in real implementation, write to flash) */
    if (transfer.buffer && transfer.received_size + len <= transfer.buffer_size) {
        memcpy(transfer.buffer + transfer.received_size, data, len);
    }
    
    transfer.received_size += len;
    
    LOG_DBG("Received %u bytes (total: %u)", len, transfer.received_size);
    
    return len;
}

/* Write trigger characteristic - starts transfer */
static ssize_t write_trigger(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                             const void *buf, uint16_t len, uint16_t offset, uint8_t flags)
{
    if (len != 4) {
        LOG_WRN("Invalid trigger length: %u (expected 4)", len);
        return BT_GATT_ERR(BT_ATT_ERR_INVALID_ATTRIBUTE_LEN);
    }
    
    uint32_t cmd = *(uint32_t *)buf;
    LOG_INF("Trigger received: 0x%08x", cmd);
    
    /* Check for the magic trigger command */
    if (cmd == TRIGGER_CMD_VALUE) {
        LOG_INF("Starting GIF receive mode");
        
        /* Reset transfer state */
        transfer.state = TRANSFER_TRIGGERED;
        transfer.received_size = 0;
        transfer.gif_valid = false;
        
        /* Send ready indication (0xFFFFFFFF) */
        int err = send_trigger_indication(READY_INDICATION);
        if (err) {
            LOG_WRN("Failed to send indication: %d", err);
        }
    } else {
        LOG_WRN("Unknown trigger command: 0x%08x", cmd);
    }
    
    return len;
}

/* Read status characteristic */
static ssize_t read_status(struct bt_conn *conn, const struct bt_gatt_attr *attr,
                           void *buf, uint16_t len, uint16_t offset)
{
    uint8_t status = (transfer.state == TRANSFER_IDLE) ? 0x01 : 0x00;
    
    return bt_gatt_attr_read(conn, attr, buf, len, offset, &status, sizeof(status));
}

/* Complete transfer (call after timeout or detecting end of GIF) */
void ble_transfer_complete(bool success)
{
    if (success && transfer.gif_valid) {
        LOG_INF("Transfer complete: %u bytes", transfer.received_size);
        transfer.state = TRANSFER_COMPLETE;
        send_notify("Transfer Complete");
        
        /* TODO: Trigger display update */
        
    } else {
        LOG_ERR("Transfer failed");
        transfer.state = TRANSFER_FAILED;
        send_notify("Transfer Fail");
    }
}

/* Initialize BLE */
int ble_service_init(uint8_t *rx_buffer, size_t rx_buffer_size)
{
    int err;
    
    /* Store buffer reference */
    transfer.buffer = rx_buffer;
    transfer.buffer_size = rx_buffer_size;
    
    /* Enable Bluetooth */
    err = bt_enable(NULL);
    if (err) {
        LOG_ERR("Bluetooth init failed (err %d)", err);
        return err;
    }
    
    LOG_INF("Bluetooth initialized");
    
    /* Start advertising */
    err = bt_le_adv_start(BT_LE_ADV_CONN, ad, ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));
    if (err) {
        LOG_ERR("Advertising failed to start (err %d)", err);
        return err;
    }
    
    LOG_INF("Advertising started");
    
    return 0;
}

/* Get transfer state */
transfer_state_t ble_get_transfer_state(void)
{
    return transfer.state;
}

/* Get received data size */
size_t ble_get_received_size(void)
{
    return transfer.received_size;
}
