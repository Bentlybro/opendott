#!/usr/bin/env python3
"""
DOTT Emergency Recovery Script

Races a boot-looping DOTT to upload a tiny valid GIF before it crashes.
Run this, then power cycle the DOTT. Script will keep trying until it succeeds.
"""

import asyncio
import sys
from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

# DOTT BLE UUIDs
DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
UUID_1525 = "00001525-0000-1000-8000-00805f9b34fb"  # Data
UUID_1528 = "00001528-0000-1000-8000-00805f9b34fb"  # Trigger

# Tiny valid 1x1 red GIF (43 bytes) - smallest possible valid GIF
TINY_GIF = bytes([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,  # GIF89a
    0x01, 0x00, 0x01, 0x00,              # 1x1
    0x80, 0x00, 0x00,                    # GCT flag, bg, aspect
    0xFF, 0x00, 0x00,                    # Red
    0x00, 0x00, 0x00,                    # Black
    0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,  # GCE
    0x2C, 0x00, 0x00, 0x00, 0x00,        # Image descriptor
    0x01, 0x00, 0x01, 0x00, 0x00,        # 1x1, no LCT
    0x02, 0x02, 0x44, 0x01, 0x00,        # LZW data
    0x3B                                 # Trailer
])

DEVICE_NAME = "Dott"
MAX_ATTEMPTS = 100
SCAN_TIMEOUT = 2.0  # Short scan window

async def quick_upload(address: str) -> bool:
    """Try to connect and upload as fast as possible"""
    try:
        async with BleakClient(address, timeout=3.0) as client:
            if not client.is_connected:
                return False
            
            print(f"  [!] CONNECTED! Uploading emergency GIF...")
            
            # Get characteristics
            data_char = None
            trigger_char = None
            
            for service in client.services:
                if DOTT_SERVICE.lower() in service.uuid.lower():
                    for char in service.characteristics:
                        if "1525" in char.uuid:
                            data_char = char
                        elif "1528" in char.uuid:
                            trigger_char = char
            
            if not data_char or not trigger_char:
                print("  [X] Couldn't find characteristics")
                return False
            
            # Send trigger (file size)
            size_bytes = len(TINY_GIF).to_bytes(4, 'little')
            await client.write_gatt_char(trigger_char.uuid, size_bytes, response=True)
            print(f"  [>] Trigger sent ({len(TINY_GIF)} bytes)")
            
            # Blast the tiny GIF
            await client.write_gatt_char(data_char.uuid, TINY_GIF, response=False)
            print(f"  [>] GIF sent!")
            
            # Wait a moment
            await asyncio.sleep(0.5)
            
            print("  [✓] UPLOAD COMPLETE! Device should stop boot looping.")
            return True
            
    except asyncio.TimeoutError:
        return False
    except BleakError as e:
        if "disconnect" not in str(e).lower():
            print(f"  [X] {e}")
        return False
    except Exception as e:
        print(f"  [X] {e}")
        return False

async def main():
    print("=" * 60)
    print("DOTT EMERGENCY RECOVERY")
    print("=" * 60)
    print()
    print("This script will keep trying to connect to your boot-looping")
    print("DOTT and upload a tiny valid GIF to stop the crash loop.")
    print()
    print("1. Make sure DOTT is powered on (even if boot looping)")
    print("2. Keep this script running")
    print("3. If needed, power cycle the DOTT")
    print()
    print("Press Ctrl+C to stop")
    print("=" * 60)
    print()
    
    attempt = 0
    last_seen = None
    
    while attempt < MAX_ATTEMPTS:
        attempt += 1
        
        # Quick scan
        sys.stdout.write(f"\r[{attempt:3d}] Scanning...".ljust(50))
        sys.stdout.flush()
        
        try:
            devices = await BleakScanner.discover(timeout=SCAN_TIMEOUT)
            
            for device in devices:
                if device.name and DEVICE_NAME.lower() in device.name.lower():
                    if device.address != last_seen:
                        print(f"\n  [*] Found: {device.name} ({device.address})")
                        last_seen = device.address
                    
                    # Try to connect immediately
                    success = await quick_upload(device.address)
                    
                    if success:
                        print("\n" + "=" * 60)
                        print("RECOVERY SUCCESSFUL!")
                        print("Your DOTT should now display a red pixel.")
                        print("You can now upload a proper image.")
                        print("=" * 60)
                        return
                    else:
                        print(f"  [~] Disconnected, retrying...")
                        
        except Exception as e:
            pass  # Keep trying
        
        await asyncio.sleep(0.1)  # Tiny delay between attempts
    
    print(f"\n[X] Failed after {MAX_ATTEMPTS} attempts")
    print("The boot loop may be too fast. SWD recovery may be needed.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nStopped.")
