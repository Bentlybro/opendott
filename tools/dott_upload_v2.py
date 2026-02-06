#!/usr/bin/env python3
"""
DOTT Image Upload Tool v2
=========================
Uses the correct multi-characteristic protocol:
- 0x1525: Control/trigger (write size header here)
- 0x1529: Data transfer (stream GIF data here)
- 0x1530: Response/completion (monitor for status)
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
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

# BLE UUIDs
UUID_DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"

# Characteristics (discovered via test_smp.py)
UUID_CONTROL = "00001525-0000-1000-8000-00805f9b34fb"   # Control/trigger
UUID_COMMAND = "00001526-0000-1000-8000-00805f9b34fb"   # Command
UUID_STATUS = "00001527-0000-1000-8000-00805f9b34fb"    # Status
UUID_ACK = "00001528-0000-1000-8000-00805f9b34fb"       # ACK (indicate)
UUID_DATA = "00001529-0000-1000-8000-00805f9b34fb"      # DATA TRANSFER
UUID_RESPONSE = "00001530-0000-1000-8000-00805f9b34fb"  # Response

# Protocol constants
CHUNK_DELAY_MS = 5
MAX_RETRIES = 5


def validate_gif(data):
    """Validate GIF file."""
    if len(data) < 13:
        return False, f"File too small ({len(data)} bytes)"
    
    magic = data[:6]
    if magic not in (b'GIF87a', b'GIF89a'):
        return False, f"Invalid magic: {magic!r}"
    
    width = struct.unpack('<H', data[6:8])[0]
    height = struct.unpack('<H', data[8:10])[0]
    
    if width > 240 or height > 240:
        return False, f"Too large: {width}x{height}"
    
    return True, f"Valid GIF: {width}x{height}"


class DOTTClientV2:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.mtu_size = 23
        self.notifications = []
        self.transfer_complete = asyncio.Event()
        
    def _notification_handler(self, sender, data):
        """Handle notifications from device."""
        print(f"  [NOTIFY] {sender}: {data.hex()[:32]}...")
        self.notifications.append((sender, data))
        
        # Check for completion signal
        # This is a guess - we'll see what the device sends
        if len(data) > 0:
            if data[0] == 0x00 or b'complete' in data.lower() if isinstance(data, bytes) else False:
                self.transfer_complete.set()
        
    async def connect(self):
        """Connect to device."""
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        print(f"Connected: {self.client.is_connected}")
        
        self.mtu_size = self.client.mtu_size or 23
        print(f"MTU: {self.mtu_size}")
        
        # Small delay for connection to stabilize
        await asyncio.sleep(0.2)
        
        # Enable notifications on response characteristic
        try:
            await self.client.start_notify(UUID_RESPONSE, self._notification_handler)
            print(f"[OK] Notifications enabled on 0x1530 (Response)")
        except Exception as e:
            print(f"[!] Could not enable notifications on 0x1530: {e}")
            
        # Try to enable notifications on data characteristic too
        try:
            await self.client.start_notify(UUID_DATA, self._notification_handler)
            print(f"[OK] Notifications enabled on 0x1529 (Data)")
        except Exception as e:
            print(f"[!] Could not enable notifications on 0x1529: {e}")
            
        # Try ACK indication
        try:
            await self.client.start_notify(UUID_ACK, self._notification_handler)
            print(f"[OK] Indications enabled on 0x1528 (ACK)")
        except Exception as e:
            print(f"[!] Could not enable indications on 0x1528: {e}")
            
    async def disconnect(self):
        """Disconnect from device."""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        print("Disconnected")
        
    async def read_status(self):
        """Read current status from various characteristics."""
        status = {}
        
        for name, uuid in [("Control", UUID_CONTROL), ("Status", UUID_STATUS), ("Response", UUID_RESPONSE)]:
            try:
                data = await self.client.read_gatt_char(uuid)
                status[name] = data
                print(f"  {name}: {data.hex()[:32]}... ({len(data)} bytes)")
            except Exception as e:
                print(f"  {name}: Error - {e}")
                
        return status
        
    async def upload_gif(self, image_path, method='v2'):
        """
        Upload a GIF using the multi-characteristic protocol.
        
        Method 'v2': 
          1. Write size to 0x1525 (Control/Trigger)
          2. Stream data to 0x1529 (Data)
          3. Monitor 0x1530 (Response) for completion
        """
        print(f"\n{'='*60}")
        print(f"DOTT Image Upload v2")
        print(f"{'='*60}\n")
        
        # Read file
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"File: {image_path}")
        print(f"Size: {len(data)} bytes")
        
        # Validate
        is_valid, message = validate_gif(data)
        print(f"Format: {message}")
        if not is_valid:
            print("[X] Invalid GIF!")
            return False
            
        chunk_size = self.mtu_size - 3
        if chunk_size < 20:
            chunk_size = 20
            
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        
        print(f"\nTransfer Settings:")
        print(f"  MTU: {self.mtu_size}")
        print(f"  Chunk size: {chunk_size} bytes")
        print(f"  Total chunks: {total_chunks}")
        
        # Read initial status
        print(f"\n--- Initial Status ---")
        await self.read_status()
        
        # STEP 1: Send size header to CONTROL characteristic (0x1525)
        print(f"\n--- Step 1: Trigger (size to 0x1525) ---")
        size_header = struct.pack('<I', len(data))
        print(f"  Writing size: {len(data)} bytes ({size_header.hex()})")
        
        try:
            await self.client.write_gatt_char(UUID_CONTROL, size_header, response=False)
            print(f"  [OK] Size header sent to Control (0x1525)")
        except Exception as e:
            print(f"  [X] Failed: {e}")
            return False
            
        # Small delay for device to process trigger
        await asyncio.sleep(0.1)
        
        # Check status after trigger
        print(f"\n--- Status after trigger ---")
        await self.read_status()
        
        # STEP 2: Stream data to DATA characteristic (0x1529)
        print(f"\n--- Step 2: Data Transfer (to 0x1529) ---")
        
        start_time = time.time()
        bytes_sent = 0
        chunk_num = 0
        
        offset = 0
        while offset < len(data):
            chunk = data[offset:offset + chunk_size]
            chunk_num += 1
            
            try:
                # Note: 0x1529 has 'write' (with response), not 'write-without-response'
                await self.client.write_gatt_char(UUID_DATA, chunk, response=True)
            except Exception as e:
                print(f"\n  [X] Write failed at chunk {chunk_num}: {e}")
                # Try without response
                try:
                    await self.client.write_gatt_char(UUID_DATA, chunk, response=False)
                except Exception as e2:
                    print(f"  [X] Retry also failed: {e2}")
                    return False
                    
            bytes_sent += len(chunk)
            offset += len(chunk)
            
            # Progress
            if chunk_num % 20 == 0 or chunk_num == total_chunks:
                progress = int((bytes_sent / len(data)) * 100)
                elapsed = time.time() - start_time
                rate = (bytes_sent * 8 / 1024) / elapsed if elapsed > 0 else 0
                print(f"  [{progress:3d}%] {bytes_sent}/{len(data)} bytes | {rate:.1f} kbps | chunk {chunk_num}/{total_chunks}")
                
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
            
        elapsed = time.time() - start_time
        rate = (len(data) * 8 / 1024) / elapsed if elapsed > 0 else 0
        
        print(f"\n--- Transfer Complete ---")
        print(f"  {len(data)} bytes in {elapsed:.2f}s ({rate:.1f} kbps)")
        
        # Wait for device to process
        print(f"\n--- Waiting for device response ---")
        await asyncio.sleep(1.0)
        
        # Check final status
        print(f"\n--- Final Status ---")
        await self.read_status()
        
        # Check notifications received
        if self.notifications:
            print(f"\n--- Notifications Received ({len(self.notifications)}) ---")
            for sender, data in self.notifications:
                print(f"  {sender}: {data.hex()}")
        else:
            print(f"\n[!] No notifications received")
            
        print(f"\n{'='*60}")
        print(f"Upload attempt complete!")
        print(f"{'='*60}\n")
        
        return True


async def main():
    parser = argparse.ArgumentParser(description="DOTT Upload v2 - Multi-characteristic protocol")
    parser.add_argument('file', help='GIF file to upload')
    parser.add_argument('-a', '--address', help='Device address')
    
    args = parser.parse_args()
    
    if not os.path.exists(args.file):
        print(f"Error: File not found: {args.file}")
        return
        
    address = args.address
    if not address:
        print("Scanning for DOTT devices...")
        devices = await BleakScanner.discover(timeout=5.0)
        dott = [d for d in devices if d.name and "dott" in d.name.lower()]
        if not dott:
            print("No DOTT device found!")
            return
        address = dott[0].address
        print(f"Found: {address}")
        
    client = DOTTClientV2(address)
    
    try:
        await client.connect()
        await client.upload_gif(args.file)
    finally:
        await client.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
