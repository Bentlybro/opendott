#!/usr/bin/env python3
"""
DOTT Image Upload Tool
======================
Upload GIF images to DOTT wearable via Bluetooth LE.

Protocol reverse-engineered from weardott Android app v1.0.5:
- Service: 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc
- Characteristic: 0x1525 (write raw data chunks)
- Just stream raw bytes - no headers, no sequence numbers!

Usage:
    python dott_upload.py scan                    # Find DOTT devices
    python dott_upload.py upload image.gif       # Upload an image
    python dott_upload.py info                   # Get device info
    python dott_upload.py test                   # Test connection
"""

import asyncio
import argparse
import struct
import sys
import os
import time
from pathlib import Path

try:
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

# ============================================================================
# BLE UUIDs - FROM DECOMPILED WEARDOTT APP
# ============================================================================

# Standard Services
UUID_BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"
UUID_DEVICE_NAME = "00002a00-0000-1000-8000-00805f9b34fb"
UUID_FIRMWARE_REV = "00002a26-0000-1000-8000-00805f9b34fb"
UUID_MODEL_NUMBER = "00002a24-0000-1000-8000-00805f9b34fb"

# DOTT Image Transfer Service (from app decompilation)
# Called "NORDIC_THROUGHPUT" in the app code
UUID_DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"
UUID_DOTT_TRANSFER = "00001525-0000-1000-8000-00805f9b34fb"  # The upload characteristic!

# Protocol constants from app
OPTIMAL_MTU = 498
DEFAULT_MTU = 23
CHUNK_DELAY_MS = 5
MAX_RETRIES = 5
BACKOFF_BASE_MS = 50
BACKOFF_MAX_MS = 1000
STABILIZATION_DELAY_MS = 100

# ============================================================================
# DOTT Client
# ============================================================================

class DOTTClient:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.connected = False
        self.mtu_size = DEFAULT_MTU
        self.transfer_char = None
        
    async def connect(self):
        """Connect to DOTT device."""
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.connected = True
        print(f"Connected: {self.client.is_connected}")
        
        # Request high MTU (like the app does)
        try:
            # Bleak handles MTU negotiation automatically on most platforms
            # The actual MTU will be whatever the device supports
            self.mtu_size = self.client.mtu_size
            print(f"MTU: {self.mtu_size}")
        except Exception as e:
            print(f"MTU negotiation note: {e}")
            self.mtu_size = DEFAULT_MTU
            
        # Find the transfer characteristic
        await self._find_transfer_characteristic()
        
    async def disconnect(self):
        """Disconnect from device."""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        self.connected = False
        print("Disconnected")
        
    async def _find_transfer_characteristic(self):
        """Find the image transfer characteristic."""
        for service in self.client.services:
            if service.uuid.lower() == UUID_DOTT_SERVICE.lower():
                print(f"✓ Found DOTT service")
                for char in service.characteristics:
                    if char.uuid.lower() == UUID_DOTT_TRANSFER.lower():
                        self.transfer_char = char
                        props = char.properties
                        print(f"✓ Found transfer characteristic (0x1525)")
                        print(f"  Properties: {props}")
                        return True
        print("✗ Transfer characteristic not found!")
        return False
        
    async def get_device_info(self):
        """Read basic device information."""
        info = {}
        
        char_map = [
            (UUID_DEVICE_NAME, 'name', 'utf-8'),
            (UUID_MODEL_NUMBER, 'model', 'utf-8'),
            (UUID_FIRMWARE_REV, 'firmware', 'utf-8'),
            (UUID_BATTERY_LEVEL, 'battery', None),
        ]
        
        for uuid, key, encoding in char_map:
            try:
                data = await self.client.read_gatt_char(uuid)
                if encoding:
                    info[key] = data.decode(encoding).strip('\x00')
                else:
                    info[key] = data[0] if len(data) == 1 else list(data)
            except:
                pass
                
        return info
        
    def _calculate_backoff(self, retry_count):
        """Calculate exponential backoff delay."""
        delay = BACKOFF_BASE_MS * (2 ** (retry_count - 1))
        return min(delay, BACKOFF_MAX_MS) / 1000.0  # Convert to seconds
        
    async def _write_chunk(self, data, use_response=False):
        """Write a single chunk with retry logic."""
        if not self.transfer_char:
            return False
            
        for attempt in range(MAX_RETRIES):
            try:
                # The app prefers write-without-response for speed
                await self.client.write_gatt_char(
                    UUID_DOTT_TRANSFER, 
                    data, 
                    response=use_response
                )
                return True
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    delay = self._calculate_backoff(attempt + 1)
                    await asyncio.sleep(delay)
                else:
                    print(f"  Write failed after {MAX_RETRIES} attempts: {e}")
                    return False
        return False
        
    async def upload_gif(self, image_path):
        """Upload a GIF file to the device."""
        print(f"\n{'='*60}")
        print(f"DOTT Image Upload")
        print(f"{'='*60}\n")
        
        if not self.transfer_char:
            print("Error: Transfer characteristic not found!")
            return False
            
        # Read file
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"File: {image_path}")
        print(f"Size: {len(data)} bytes")
        
        # Validate GIF
        if data.startswith(b'GIF89a') or data.startswith(b'GIF87a'):
            print(f"Format: GIF ✓")
        else:
            print(f"Warning: Not a GIF file! First bytes: {data[:6].hex()}")
            
        # Calculate chunk size (MTU - 3 ATT header bytes)
        chunk_size = self.mtu_size - 3
        if chunk_size < 20:
            chunk_size = 20  # Minimum safe chunk size
            
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        
        print(f"MTU: {self.mtu_size}")
        print(f"Chunk size: {chunk_size} bytes")
        print(f"Total chunks: {total_chunks}")
        
        print(f"\n--- Starting Transfer ---\n")
        
        start_time = time.time()
        bytes_sent = 0
        chunk_num = 0
        
        # Stream raw data chunks (this is exactly what the app does!)
        offset = 0
        while offset < len(data):
            chunk = data[offset:offset + chunk_size]
            chunk_num += 1
            
            # Write chunk
            if not await self._write_chunk(chunk):
                print(f"\n✗ Failed to send chunk {chunk_num}")
                return False
                
            bytes_sent += len(chunk)
            offset += len(chunk)
            
            # Progress update
            progress = int((bytes_sent / len(data)) * 100)
            if chunk_num % 50 == 0 or chunk_num == total_chunks:
                elapsed = time.time() - start_time
                rate = (bytes_sent * 8 / 1024) / elapsed if elapsed > 0 else 0
                print(f"  Progress: {progress}% ({bytes_sent}/{len(data)} bytes, {rate:.1f} kbps)")
                
            # Small delay between chunks (as per app protocol)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
            
        # Complete!
        elapsed = time.time() - start_time
        rate = (len(data) * 8 / 1024) / elapsed if elapsed > 0 else 0
        
        print(f"\n{'='*60}")
        print(f"✓ Upload Complete!")
        print(f"  {len(data)} bytes in {elapsed:.2f}s ({rate:.1f} kbps)")
        print(f"{'='*60}\n")
        
        # Stabilization delay (as per app)
        await asyncio.sleep(STABILIZATION_DELAY_MS / 1000.0)
        
        return True
        
    async def test_connection(self):
        """Test connection and show device info."""
        print("\n" + "="*60)
        print("Connection Test")
        print("="*60 + "\n")
        
        info = await self.get_device_info()
        print("Device Info:")
        for k, v in info.items():
            print(f"  {k}: {v}")
            
        print(f"\nTransfer Characteristic: {'Found ✓' if self.transfer_char else 'NOT FOUND ✗'}")
        print(f"MTU Size: {self.mtu_size}")
        
        if self.transfer_char:
            print("\nReady to upload!")
        else:
            print("\nDevice does not support image upload.")


# ============================================================================
# CLI Commands
# ============================================================================

async def cmd_scan():
    """Scan for DOTT devices."""
    print("Scanning for DOTT devices...\n")
    
    devices = await BleakScanner.discover(timeout=5.0)
    
    dott_devices = []
    for d in devices:
        name = d.name or "Unknown"
        if "dott" in name.lower():
            dott_devices.append(d)
            rssi = getattr(d, 'rssi', 'N/A')
            print(f"  ✓ DOTT: {d.address} - {name} (RSSI: {rssi})")
        else:
            print(f"    {d.address} - {name}")
            
    if dott_devices:
        print(f"\nFound {len(dott_devices)} DOTT device(s)")
        return dott_devices[0].address
    else:
        print("\nNo DOTT devices found")
        return None


async def cmd_info(address):
    """Get device information."""
    client = DOTTClient(address)
    
    try:
        await client.connect()
        await client.test_connection()
    finally:
        await client.disconnect()


async def cmd_upload(address, image_path):
    """Upload an image to the device."""
    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return
        
    client = DOTTClient(address)
    
    try:
        await client.connect()
        success = await client.upload_gif(image_path)
        if success:
            print("The GIF should now be displaying on your DOTT!")
    finally:
        await client.disconnect()


async def cmd_test(address):
    """Test connection."""
    await cmd_info(address)


# ============================================================================
# Main
# ============================================================================

async def main():
    parser = argparse.ArgumentParser(description="DOTT Image Upload Tool")
    parser.add_argument('command', choices=['scan', 'info', 'upload', 'test'],
                       help='Command to run')
    parser.add_argument('file', nargs='?', help='Image file to upload')
    parser.add_argument('-a', '--address', help='Device address (skip scan)')
    
    args = parser.parse_args()
    
    address = args.address
    
    if not address and args.command != 'scan':
        address = await cmd_scan()
        if not address:
            print("No device found. Specify address with -a")
            return
        print(f"\nUsing device: {address}\n")
        
    if args.command == 'scan':
        await cmd_scan()
    elif args.command == 'info':
        await cmd_info(address)
    elif args.command == 'test':
        await cmd_test(address)
    elif args.command == 'upload':
        if not args.file:
            print("Error: upload requires a file argument")
            return
        await cmd_upload(address, args.file)


if __name__ == '__main__':
    asyncio.run(main())
