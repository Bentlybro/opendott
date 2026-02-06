#!/usr/bin/env python3
"""
DOTT Image Upload Tool
======================
Upload GIF images to DOTT wearable via Bluetooth LE.

Protocol (fully reverse-engineered):
1. Write 0x00401000 to 0x1528 (trigger command)
2. Wait for indication 0xFFFFFFFF (device ready)
3. Stream raw GIF bytes to 0x1525 (no headers!)
4. Device responds "Transfer Complete"

Usage:
    python dott_upload.py scan              # Find DOTT devices
    python dott_upload.py upload image.gif  # Upload an image
    python dott_upload.py info              # Get device info
"""

import asyncio
import argparse
import struct
import sys
import os
import time

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

# BLE UUIDs
UUID_DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
UUID_TRIGGER = "00001528-0000-1000-8000-00805f9b34fb"  # Trigger characteristic (indicate)
UUID_DATA = "00001525-0000-1000-8000-00805f9b34fb"     # Data characteristic
UUID_1529 = "00001529-0000-1000-8000-00805f9b34fb"     # Notify
UUID_1530 = "00001530-0000-1000-8000-00805f9b34fb"     # Notify

# Protocol constants
TRIGGER_CMD = bytes([0x00, 0x40, 0x10, 0x00])  # Magic trigger command
CHUNK_DELAY_MS = 5


def validate_gif(data):
    """Validate that data is a valid GIF file."""
    if len(data) < 13:
        return False, f"File too small ({len(data)} bytes)"
    
    magic = data[:6]
    if magic not in (b'GIF87a', b'GIF89a'):
        return False, f"Invalid GIF magic: {magic!r}"
    
    width = struct.unpack('<H', data[6:8])[0]
    height = struct.unpack('<H', data[8:10])[0]
    
    if width > 240 or height > 240:
        return False, f"Image too large: {width}x{height} (max 240x240)"
    
    return True, f"Valid GIF: {width}x{height}"


class DOTTClient:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.mtu_size = 23
        self.notifications = []
        self.ready_event = asyncio.Event()
        
    def _notification_handler(self, sender, data):
        text = data.decode('utf-8', errors='ignore')
        self.notifications.append(text)
        if data == b'\xff\xff\xff\xff':
            self.ready_event.set()
        if text:
            print(f"  Device: {text}")
        
    async def connect(self):
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        
        self.mtu_size = self.client.mtu_size or 23
        print(f"Connected (MTU: {self.mtu_size})")
        
        # Enable notifications on all relevant characteristics
        for uuid in [UUID_TRIGGER, UUID_1529, UUID_1530]:
            try:
                await self.client.start_notify(uuid, self._notification_handler)
            except:
                pass
                
        await asyncio.sleep(0.2)
        
    async def disconnect(self):
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        print("Disconnected")
        
    async def upload_gif(self, image_path, force=False):
        """Upload a GIF file to the device."""
        print(f"\n{'='*50}")
        print("DOTT Image Upload")
        print(f"{'='*50}\n")
        
        # Read file
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"File: {os.path.basename(image_path)}")
        print(f"Size: {len(data)} bytes")
        
        # Validate
        is_valid, message = validate_gif(data)
        print(f"Format: {message}")
        
        if not is_valid and not force:
            print("\n[!] Invalid GIF - use --force to upload anyway")
            return False
            
        chunk_size = self.mtu_size - 3
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        
        print(f"\nChunks: {total_chunks} x {chunk_size} bytes")
        
        # Step 1: Send trigger command
        print("\nSending trigger command...")
        self.ready_event.clear()
        self.notifications.clear()
        
        await self.client.write_gatt_char(UUID_TRIGGER, TRIGGER_CMD, response=True)
        
        # Wait for device ready indication
        try:
            await asyncio.wait_for(self.ready_event.wait(), timeout=2.0)
            print("Device ready!")
        except asyncio.TimeoutError:
            print("Warning: No ready indication (continuing anyway)")
        
        # Step 2: Stream GIF data
        print(f"\nUploading", end="", flush=True)
        start_time = time.time()
        
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await self.client.write_gatt_char(UUID_DATA, chunk, response=False)
            
            # Progress dots
            if (i // chunk_size) % 20 == 0:
                print(".", end="", flush=True)
                
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
            
        elapsed = time.time() - start_time
        rate = (len(data) * 8 / 1024) / elapsed if elapsed > 0 else 0
        print(f" done!")
        print(f"\nTransferred {len(data)} bytes in {elapsed:.2f}s ({rate:.1f} kbps)")
        
        # Wait for completion
        print("\nWaiting for device...")
        await asyncio.sleep(1.5)
        
        # Check result
        if any('complete' in n.lower() for n in self.notifications):
            print("\n" + "="*50)
            print("[OK] Upload successful! Check your DOTT display!")
            print("="*50 + "\n")
            return True
        elif any('fail' in n.lower() for n in self.notifications):
            print("\n[X] Upload failed")
            return False
        else:
            print("\n[?] No response - check if display updated")
            return None


async def cmd_scan():
    """Scan for DOTT devices."""
    print("Scanning for DOTT devices...\n")
    
    devices = await BleakScanner.discover(timeout=5.0)
    
    dott_devices = []
    for d in devices:
        name = d.name or "Unknown"
        if "dott" in name.lower():
            dott_devices.append(d)
            print(f"  [OK] {d.address} - {name}")
    
    if dott_devices:
        print(f"\nFound {len(dott_devices)} DOTT device(s)")
        return dott_devices[0].address
    else:
        print("No DOTT devices found")
        return None


async def cmd_upload(address, image_path, force=False):
    """Upload an image to the device."""
    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return
        
    client = DOTTClient(address)
    
    try:
        await client.connect()
        await client.upload_gif(image_path, force=force)
    finally:
        await client.disconnect()


async def cmd_info(address):
    """Get device information."""
    client = DOTTClient(address)
    
    try:
        await client.connect()
        print("\nDevice connected successfully!")
        print(f"MTU: {client.mtu_size}")
        print("\nReady for uploads.")
    finally:
        await client.disconnect()


async def main():
    parser = argparse.ArgumentParser(
        description="DOTT Image Upload Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('command', choices=['scan', 'upload', 'info'],
                       help='Command to run')
    parser.add_argument('file', nargs='?', help='GIF file to upload')
    parser.add_argument('-a', '--address', help='Device address')
    parser.add_argument('-f', '--force', action='store_true',
                       help='Force upload even if validation fails')
    
    args = parser.parse_args()
    
    address = args.address
    
    if args.command == 'scan':
        await cmd_scan()
        return
        
    if not address:
        address = await cmd_scan()
        if not address:
            return
        print()
        
    if args.command == 'info':
        await cmd_info(address)
    elif args.command == 'upload':
        if not args.file:
            print("Error: upload requires a file argument")
            return
        await cmd_upload(address, args.file, force=args.force)


if __name__ == '__main__':
    asyncio.run(main())
