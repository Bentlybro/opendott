#!/usr/bin/env python3
"""
Test SMP/MCUmgr commands on DOTT device.

The firmware has strings like:
- "Trigger received"
- "Erase started for size = %u"
- "Still waiting: total_written = %d, expected = %d"

This suggests there might be an SMP command needed to trigger receive mode.
"""

import asyncio
import struct
import sys

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

# BLE UUIDs
UUID_DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
UUID_DOTT_TRANSFER = "00001525-0000-1000-8000-00805f9b34fb"

# MCUmgr SMP service (separate from DOTT service)
UUID_SMP_SERVICE = "8d53dc1d-1db7-4cd3-868b-8a527460aa84"
UUID_SMP_CHAR = "da2e7828-fbce-4e01-ae9e-261174997c48"

def build_smp_header(op, flags, length, group, seq, cmd_id):
    """Build SMP header (8 bytes)"""
    return struct.pack('>BBHHBB', op, flags, length, group, seq, cmd_id)

def build_simple_cbor_map(data):
    """Build simple CBOR map for key-value pairs"""
    # Very basic CBOR encoding for small maps
    # This is a simplified version, not full CBOR
    result = bytearray()
    result.append(0xa0 + len(data))  # Map with N items
    
    for k, v in data.items():
        # Key (string)
        key_bytes = k.encode('utf-8')
        if len(key_bytes) < 24:
            result.append(0x60 + len(key_bytes))
        else:
            result.append(0x78)
            result.append(len(key_bytes))
        result.extend(key_bytes)
        
        # Value (integer)
        if isinstance(v, int):
            if v < 24:
                result.append(v)
            elif v < 256:
                result.append(0x18)
                result.append(v)
            elif v < 65536:
                result.append(0x19)
                result.extend(struct.pack('>H', v))
            else:
                result.append(0x1a)
                result.extend(struct.pack('>I', v))
        elif isinstance(v, bytes):
            if len(v) < 24:
                result.append(0x40 + len(v))
            else:
                result.append(0x58)
                result.append(len(v))
            result.extend(v)
    
    return bytes(result)


async def test_device(address):
    print(f"Connecting to {address}...")
    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")
        print(f"MTU: {client.mtu_size}")
        
        # List all services
        print("\n=== Services ===")
        for service in client.services:
            print(f"\n{service.uuid}")
            for char in service.characteristics:
                print(f"  {char.uuid}: {char.properties}")
        
        # Try reading DOTT transfer characteristic
        print("\n=== Reading DOTT Transfer Characteristic ===")
        try:
            value = await client.read_gatt_char(UUID_DOTT_TRANSFER)
            print(f"Length: {len(value)} bytes")
            print(f"First 64 bytes: {value[:64].hex()}")
        except Exception as e:
            print(f"Error: {e}")
            
        # Try the SMP characteristic
        print("\n=== Checking SMP Service ===")
        try:
            smp_value = await client.read_gatt_char(UUID_SMP_CHAR)
            print(f"SMP char value: {smp_value.hex()}")
        except Exception as e:
            print(f"SMP read error (expected if no pending response): {e}")
            
        # Enable notifications on DOTT characteristic
        print("\n=== Testing Notifications ===")
        notifications = []
        
        def notification_handler(sender, data):
            notifications.append(data)
            print(f"Notification from {sender}: {data.hex()[:64]}...")
        
        try:
            await client.start_notify(UUID_DOTT_TRANSFER, notification_handler)
            print("Notifications enabled on DOTT transfer char")
        except Exception as e:
            print(f"Can't enable notifications: {e}")
            
        # Try writing size header + small amount of data
        print("\n=== Testing Size Header Write ===")
        test_gif_data = bytes.fromhex('474946383961')  # Just "GIF89a"
        size_header = struct.pack('<I', 2365)  # Pretend we're sending 2365 bytes
        
        print(f"Writing size header: {size_header.hex()}")
        try:
            await client.write_gatt_char(UUID_DOTT_TRANSFER, size_header, response=False)
            print("Size header written successfully")
            await asyncio.sleep(0.5)
            
            # Check if there's a notification response
            if notifications:
                print(f"Got {len(notifications)} notification(s)")
                for n in notifications:
                    print(f"  {n.hex()}")
        except Exception as e:
            print(f"Write error: {e}")
            
        # Read back the characteristic
        try:
            value = await client.read_gatt_char(UUID_DOTT_TRANSFER)
            print(f"After write, char value: {value[:64].hex()}...")
        except Exception as e:
            print(f"Read error: {e}")
            
        await asyncio.sleep(1)
        print(f"\nTotal notifications received: {len(notifications)}")


async def main():
    if len(sys.argv) > 1:
        address = sys.argv[1]
    else:
        print("Scanning for DOTT devices...")
        devices = await BleakScanner.discover(timeout=5.0)
        dott = [d for d in devices if d.name and "dott" in d.name.lower()]
        if not dott:
            print("No DOTT device found!")
            return
        address = dott[0].address
        print(f"Found: {address}")
    
    await test_device(address)


if __name__ == '__main__':
    asyncio.run(main())
