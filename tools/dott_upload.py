#!/usr/bin/env python3
"""
DOTT Image Upload Tool
======================
Upload GIF images to DOTT wearable via Bluetooth LE.

Protocol fully reverse-engineered from weardott Android app v1.0.5:

HOW IT WORKS:
  1. Connect to device
  2. Request high MTU (498 optimal, device negotiates down)
  3. Find service 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc
  4. Find characteristic 0x1525
  5. Stream RAW GIF bytes in chunks of (MTU - 3)
  6. 5ms delay between chunks
  7. Done! No headers, no ACKs, no SMP - just raw bytes!

CRITICAL: The app sends NO size header, NO sequence numbers, just raw GIF data.
          Previous versions of this tool added a size header which was WRONG.

Usage:
    python dott_upload.py scan                    # Find DOTT devices
    python dott_upload.py upload image.gif       # Upload an image
    python dott_upload.py upload image.gif -f    # Force upload (skip validation)
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
CONNECTION_SETTLE_MS = 500  # Let connection stabilize before operations

# ============================================================================
# GIF Validation
# ============================================================================

def validate_gif(data):
    """
    Validate that data is a valid GIF file.
    Returns (is_valid, error_message)
    """
    if len(data) < 13:
        return False, f"File too small ({len(data)} bytes, need at least 13)"
    
    # Check magic bytes
    magic = data[:6]
    if magic not in (b'GIF87a', b'GIF89a'):
        return False, f"Invalid GIF magic bytes: {magic!r} (expected GIF87a or GIF89a)"
    
    # Parse logical screen descriptor
    width = struct.unpack('<H', data[6:8])[0]
    height = struct.unpack('<H', data[8:10])[0]
    
    if width == 0 or height == 0:
        return False, f"Invalid dimensions: {width}x{height}"
    
    if width > 240 or height > 240:
        return False, f"Image too large: {width}x{height} (max 240x240 for DOTT display)"
    
    # Check for GIF trailer (should end with 0x3B)
    if data[-1:] != b'\x3b':
        return False, "Missing GIF trailer byte (0x3B) - file may be truncated"
    
    return True, f"Valid GIF: {width}x{height}"


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
        self.write_type = None  # 'write' or 'write-without-response'
        
    async def connect(self):
        """Connect to DOTT device."""
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.connected = True
        print(f"Connected: {self.client.is_connected}")
        
        # Let connection stabilize (important for Windows!)
        await asyncio.sleep(CONNECTION_SETTLE_MS / 1000.0)
        
        # Get MTU - handle platform differences
        try:
            self.mtu_size = self.client.mtu_size
            if self.mtu_size is None or self.mtu_size < DEFAULT_MTU:
                self.mtu_size = DEFAULT_MTU
            print(f"MTU: {self.mtu_size}")
        except Exception as e:
            print(f"MTU query not supported, using default: {DEFAULT_MTU}")
            self.mtu_size = DEFAULT_MTU
            
        # Find the transfer characteristic
        await self._find_transfer_characteristic()
        
        # Another small delay before operations
        await asyncio.sleep(STABILIZATION_DELAY_MS / 1000.0)
        
    async def disconnect(self):
        """Disconnect from device."""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        self.connected = False
        print("Disconnected")
        
    async def _find_transfer_characteristic(self):
        """Find the image transfer characteristic and determine write type."""
        for service in self.client.services:
            if service.uuid.lower() == UUID_DOTT_SERVICE.lower():
                print(f"[OK] Found DOTT service")
                for char in service.characteristics:
                    if char.uuid.lower() == UUID_DOTT_TRANSFER.lower():
                        self.transfer_char = char
                        props = char.properties
                        print(f"[OK] Found transfer characteristic (0x1525)")
                        print(f"  Properties: {props}")
                        
                        # Determine best write type (prefer write-without-response for speed)
                        if 'write-without-response' in props:
                            self.write_type = 'write-without-response'
                            print(f"  Using: write-without-response (fast)")
                        elif 'write' in props:
                            self.write_type = 'write'
                            print(f"  Using: write (with response)")
                        else:
                            print(f"  Warning: No write property found!")
                            
                        return True
        print("[X] Transfer characteristic not found!")
        print("  Available services:")
        for service in self.client.services:
            print(f"    {service.uuid}")
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
        
    async def _write_chunk(self, data):
        """Write a single chunk with retry logic."""
        if not self.transfer_char:
            return False
        
        # Use response=False for write-without-response (faster)
        use_response = (self.write_type == 'write')
            
        for attempt in range(MAX_RETRIES):
            try:
                await self.client.write_gatt_char(
                    UUID_DOTT_TRANSFER, 
                    data, 
                    response=use_response
                )
                return True
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    delay = self._calculate_backoff(attempt + 1)
                    print(f"  Retry {attempt + 1}/{MAX_RETRIES} after {delay*1000:.0f}ms: {e}")
                    await asyncio.sleep(delay)
                else:
                    print(f"  Write failed after {MAX_RETRIES} attempts: {e}")
                    return False
        return False
        
    async def upload_gif(self, image_path, force=False, send_size_header=False):
        """
        Upload a GIF file to the device.
        
        The official app sends RAW GIF BYTES with NO header.
        Setting send_size_header=True is for experimentation only.
        """
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
        is_valid, message = validate_gif(data)
        if is_valid:
            print(f"Format: {message} [OK]")
        else:
            print(f"Format: {message} [X]")
            if not force:
                print("\n[!]  UPLOAD BLOCKED: Invalid GIF file!")
                print("   This protects your device from bricking.")
                print("   Use --force (-f) to upload anyway (at your own risk).")
                return False
            else:
                print("\n[!]  WARNING: Forcing upload of invalid file!")
                print("   This may crash your device or require a reset.")
                await asyncio.sleep(1)  # Give user a moment to cancel
            
        # Calculate chunk size (MTU - 3 ATT header bytes)
        chunk_size = self.mtu_size - 3
        if chunk_size < 20:
            chunk_size = 20  # Minimum safe chunk size
            
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        
        print(f"\nTransfer Settings:")
        print(f"  MTU: {self.mtu_size}")
        print(f"  Chunk size: {chunk_size} bytes")
        print(f"  Total chunks: {total_chunks}")
        print(f"  Write type: {self.write_type}")
        print(f"  Inter-chunk delay: {CHUNK_DELAY_MS}ms")
        print(f"  Mode: {'RAW bytes (app protocol)' if not send_size_header else 'with size header (experimental)'}")
        
        print(f"\n--- Starting Transfer ---\n")
        
        # Try reading characteristic first (might reveal protocol info)
        try:
            initial_value = await self.client.read_gatt_char(UUID_DOTT_TRANSFER)
            print(f"  Initial char value: {initial_value.hex()[:64]}{'...' if len(initial_value) > 32 else ''} ({len(initial_value)} bytes)")
        except Exception as e:
            print(f"  Could not read characteristic: {e}")
        
        start_time = time.time()
        bytes_sent = 0
        chunk_num = 0
        last_progress_time = start_time
        
        # Default: Send raw GIF data (matches official app behavior)
        # Optional: Prepend size header for experimentation
        if send_size_header:
            size_header = struct.pack('<I', len(data))  # 4-byte little-endian
            transfer_data = size_header + data
            print(f"  [EXPERIMENTAL] Sending size header: {len(data)} bytes (0x{len(data):08x})")
        else:
            transfer_data = data
            print(f"  Sending RAW GIF data (official protocol)")
        
        total_to_send = len(transfer_data)
        total_chunks = (total_to_send + chunk_size - 1) // chunk_size
        print(f"  Total transfer: {total_to_send} bytes in {total_chunks} chunks")
        
        # Stream raw data chunks
        offset = 0
        while offset < len(transfer_data):
            chunk = transfer_data[offset:offset + chunk_size]
            chunk_num += 1
            
            # Write chunk
            if not await self._write_chunk(chunk):
                print(f"\n[X] Failed to send chunk {chunk_num}")
                return False
                
            bytes_sent += len(chunk)
            offset += len(chunk)
            
            # Progress update (every 50 chunks or at the end)
            now = time.time()
            if chunk_num % 50 == 0 or chunk_num == total_chunks or (now - last_progress_time) > 1.0:
                progress = int((bytes_sent / total_to_send) * 100)
                elapsed = now - start_time
                rate = (bytes_sent * 8 / 1024) / elapsed if elapsed > 0 else 0
                print(f"  [{progress:3d}%] {bytes_sent:>6}/{total_to_send} bytes | {rate:>6.1f} kbps | chunk {chunk_num}/{total_chunks}")
                last_progress_time = now
                
            # Small delay between chunks (as per app protocol)
            await asyncio.sleep(CHUNK_DELAY_MS / 1000.0)
            
        # Complete!
        elapsed = time.time() - start_time
        rate = (total_to_send * 8 / 1024) / elapsed if elapsed > 0 else 0
        
        print(f"\n{'='*60}")
        print(f"[OK] Upload Complete!")
        print(f"  {len(data)} bytes sent in {elapsed:.2f}s ({rate:.1f} kbps)")
        print(f"{'='*60}\n")
        
        # Stabilization delay (as per app)
        print("Waiting for device to process...")
        await asyncio.sleep(1.0)  # Give it a full second
        
        # Check characteristic state after transfer
        try:
            final_value = await self.client.read_gatt_char(UUID_DOTT_TRANSFER)
            print(f"  Final char value: {final_value.hex()[:64]}{'...' if len(final_value) > 32 else ''} ({len(final_value)} bytes)")
        except Exception as e:
            print(f"  Could not read final state: {e}")
        
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
            
        print(f"\nBLE Configuration:")
        print(f"  Transfer Characteristic: {'Found [OK]' if self.transfer_char else 'NOT FOUND [X]'}")
        print(f"  MTU Size: {self.mtu_size}")
        print(f"  Chunk Size: {self.mtu_size - 3} bytes")
        print(f"  Write Type: {self.write_type or 'unknown'}")
        
        if self.transfer_char:
            print("\n[OK] Ready to upload!")
        else:
            print("\n[X] Device does not support image upload.")


# ============================================================================
# CLI Commands
# ============================================================================

async def cmd_scan():
    """Scan for DOTT devices."""
    print("Scanning for DOTT devices (5 seconds)...\n")
    
    devices = await BleakScanner.discover(timeout=5.0)
    
    dott_devices = []
    other_devices = []
    
    for d in devices:
        name = d.name or "Unknown"
        rssi = getattr(d, 'rssi', 'N/A')
        if "dott" in name.lower():
            dott_devices.append(d)
            print(f"  [OK] DOTT: {d.address} - {name} (RSSI: {rssi})")
        else:
            other_devices.append((d, name, rssi))
    
    if dott_devices:
        print(f"\nFound {len(dott_devices)} DOTT device(s)")
        if len(dott_devices) > 1:
            print("Multiple devices found - specify with -a ADDRESS")
        return dott_devices[0].address
    else:
        print("\nNo DOTT devices found.")
        print(f"\nOther devices ({len(other_devices)}):")
        for d, name, rssi in other_devices[:10]:
            print(f"    {d.address} - {name}")
        if len(other_devices) > 10:
            print(f"    ... and {len(other_devices) - 10} more")
        return None


async def cmd_info(address):
    """Get device information."""
    client = DOTTClient(address)
    
    try:
        await client.connect()
        await client.test_connection()
    finally:
        await client.disconnect()


async def cmd_upload(address, image_path, force=False, with_header=False):
    """Upload an image to the device."""
    if not os.path.exists(image_path):
        print(f"Error: File not found: {image_path}")
        return
        
    client = DOTTClient(address)
    
    try:
        await client.connect()
        success = await client.upload_gif(image_path, force=force, send_size_header=with_header)
        if success:
            print("The GIF should now be displaying on your DOTT!")
        else:
            if not with_header:
                print("\nTip: If upload succeeded but display didn't change, try --header flag")
    finally:
        await client.disconnect()


async def cmd_test(address):
    """Test connection."""
    await cmd_info(address)


async def cmd_validate(file_path):
    """Validate a GIF file without uploading."""
    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        return
        
    with open(file_path, 'rb') as f:
        data = f.read()
        
    print(f"File: {file_path}")
    print(f"Size: {len(data)} bytes")
    
    is_valid, message = validate_gif(data)
    if is_valid:
        print(f"Result: {message} [OK]")
        print("\nThis file is safe to upload to your DOTT.")
    else:
        print(f"Result: {message} [X]")
        print("\nThis file would be REJECTED to protect your device.")


# ============================================================================
# Main
# ============================================================================

async def main():
    parser = argparse.ArgumentParser(
        description="DOTT Image Upload Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s scan                     Scan for DOTT devices
  %(prog)s upload cat.gif           Upload a GIF to your DOTT
  %(prog)s upload cat.gif -f        Force upload (skip validation)
  %(prog)s validate cat.gif         Check if a file is a valid GIF
  %(prog)s info                     Show device info
  %(prog)s test -a E2:E2:B4:44:D5:30   Test specific device
        """
    )
    parser.add_argument('command', choices=['scan', 'info', 'upload', 'test', 'validate'],
                       help='Command to run')
    parser.add_argument('file', nargs='?', help='Image file to upload/validate')
    parser.add_argument('-a', '--address', help='Device address (skip scan)')
    parser.add_argument('-f', '--force', action='store_true',
                       help='Force upload even if validation fails (dangerous!)')
    parser.add_argument('--header', action='store_true',
                       help='Add 4-byte size header (experimental - app does NOT do this)')
    
    args = parser.parse_args()
    
    # Validate command handles its own file, no device needed
    if args.command == 'validate':
        if not args.file:
            print("Error: validate requires a file argument")
            return
        await cmd_validate(args.file)
        return
    
    address = args.address
    
    if not address and args.command != 'scan':
        address = await cmd_scan()
        if not address:
            print("\nNo device found. Specify address with -a")
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
        await cmd_upload(address, args.file, force=args.force, with_header=args.header)


if __name__ == '__main__':
    asyncio.run(main())
