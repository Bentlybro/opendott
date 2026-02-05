#!/usr/bin/env python3
"""
DOTT Image Upload Tool
======================
Upload images to DOTT wearable via Bluetooth LE.

Supports multiple transfer methods:
1. MCUmgr Filesystem (SMP Group 8)
2. Custom service (f000ffe1)
3. Legacy service (0xFFF2)

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
from pathlib import Path

try:
    from bleak import BleakClient, BleakScanner
    from bleak.exc import BleakError
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)

try:
    import cbor2
except ImportError:
    print("Warning: cbor2 not installed. MCUmgr commands won't work.")
    print("Run: pip install cbor2")
    cbor2 = None

# ============================================================================
# BLE UUIDs
# ============================================================================

# Standard Services
UUID_BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"
UUID_DEVICE_NAME = "00002a00-0000-1000-8000-00805f9b34fb"
UUID_FIRMWARE_REV = "00002a26-0000-1000-8000-00805f9b34fb"

# MCUmgr SMP Service
UUID_SMP_SERVICE = "8d53dc1d-1db7-4cd3-868b-8a527460aa84"
UUID_SMP_CHAR = "da2e7828-fbce-4e01-ae9e-261174997c48"

# Custom Service (TI-style)
UUID_CUSTOM_SERVICE = "f000ffe0-0451-4000-b000-000000000000"
UUID_CUSTOM_WRITE = "f000ffe1-0451-4000-b000-000000000000"
UUID_CUSTOM_NOTIFY = "f000ffe2-0451-4000-b000-000000000000"

# Legacy Service (short UUIDs)
UUID_LEGACY_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"
UUID_LEGACY_NOTIFY = "0000fff1-0000-1000-8000-00805f9b34fb"
UUID_LEGACY_WRITE = "0000fff2-0000-1000-8000-00805f9b34fb"

# ============================================================================
# MCUmgr SMP Protocol
# ============================================================================

class SMPOp:
    READ = 0
    READ_RSP = 1
    WRITE = 2
    WRITE_RSP = 3

class SMPGroup:
    OS = 0
    IMAGE = 1
    STAT = 2
    CONFIG = 3
    LOG = 4
    CRASH = 5
    SPLIT = 6
    RUN = 7
    FS = 8
    SHELL = 9

class SMPCmd:
    # OS Group
    OS_ECHO = 0
    OS_TASK_STATS = 2
    OS_MPSTAT = 3
    OS_DATETIME = 4
    OS_RESET = 5
    OS_MCUMGR_PARAMS = 6
    
    # FS Group
    FS_FILE = 0  # Read/Write file
    FS_STAT = 1  # File stat
    FS_HASH = 2  # File hash
    
    # Image Group
    IMG_STATE = 0
    IMG_UPLOAD = 1
    IMG_ERASE = 5


def build_smp_packet(op, group, cmd_id, data=None, seq=0):
    """Build an SMP packet with CBOR payload."""
    if data is None:
        data = {}
    
    if cbor2 is None:
        raise RuntimeError("cbor2 not installed")
    
    payload = cbor2.dumps(data)
    
    # SMP header: op(1) + flags(1) + len(2, BE) + group(2, BE) + seq(1) + cmd(1)
    header = struct.pack('>BBHHBB', 
                        op,           # Operation
                        0,            # Flags
                        len(payload), # Payload length
                        group,        # Group ID
                        seq,          # Sequence
                        cmd_id)       # Command ID
    
    return header + payload


def parse_smp_response(data):
    """Parse an SMP response packet."""
    if len(data) < 8:
        return None, None, data
    
    op, flags, length, group, seq, cmd = struct.unpack('>BBHHBB', data[:8])
    payload = data[8:8+length]
    
    result = None
    if cbor2 and payload:
        try:
            result = cbor2.loads(payload)
        except:
            result = payload
    
    return {
        'op': op,
        'group': group,
        'cmd': cmd,
        'seq': seq,
    }, result, data[8+length:]


# ============================================================================
# DOTT Client
# ============================================================================

class DOTTClient:
    def __init__(self, address):
        self.address = address
        self.client = None
        self.smp_seq = 0
        self.responses = asyncio.Queue()
        self.connected = False
        
    async def connect(self):
        """Connect to DOTT device."""
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.connected = True
        print(f"Connected: {self.client.is_connected}")
        
        # Enable notifications on all relevant characteristics
        await self._setup_notifications()
        
    async def disconnect(self):
        """Disconnect from device."""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        self.connected = False
        print("Disconnected")
        
    async def _setup_notifications(self):
        """Enable notifications on response characteristics."""
        
        def make_handler(name):
            def handler(sender, data):
                print(f"[{name}] Notification: {data.hex()}")
                self.responses.put_nowait((name, data))
            return handler
        
        # Try each notification characteristic
        notify_chars = [
            (UUID_SMP_CHAR, "SMP"),
            (UUID_CUSTOM_NOTIFY, "Custom"),
            (UUID_LEGACY_NOTIFY, "Legacy"),
        ]
        
        for uuid, name in notify_chars:
            try:
                await self.client.start_notify(uuid, make_handler(name))
                print(f"  ✓ Notifications enabled on {name} ({uuid[:8]}...)")
            except Exception as e:
                print(f"  ✗ Failed to enable {name}: {e}")
                
    async def get_device_info(self):
        """Read basic device information."""
        info = {}
        
        try:
            data = await self.client.read_gatt_char(UUID_DEVICE_NAME)
            info['name'] = data.decode('utf-8')
        except:
            pass
            
        try:
            data = await self.client.read_gatt_char(UUID_BATTERY_LEVEL)
            info['battery'] = data[0]
        except:
            pass
            
        try:
            data = await self.client.read_gatt_char(UUID_FIRMWARE_REV)
            info['firmware'] = data.decode('utf-8')
        except:
            pass
            
        return info
        
    async def smp_command(self, group, cmd, data=None, timeout=5.0):
        """Send an SMP command and wait for response."""
        self.smp_seq = (self.smp_seq + 1) % 256
        
        packet = build_smp_packet(SMPOp.WRITE, group, cmd, data, self.smp_seq)
        
        print(f"  Sending SMP: group={group}, cmd={cmd}, seq={self.smp_seq}")
        print(f"  Packet: {packet.hex()}")
        
        try:
            await self.client.write_gatt_char(UUID_SMP_CHAR, packet, response=False)
        except Exception as e:
            print(f"  Write failed: {e}")
            return None
            
        # Wait for response
        try:
            name, response = await asyncio.wait_for(self.responses.get(), timeout)
            header, result, _ = parse_smp_response(response)
            print(f"  Response: {result}")
            return result
        except asyncio.TimeoutError:
            print("  Timeout waiting for response")
            return None
            
    async def smp_echo(self, message="hello"):
        """Test SMP with echo command."""
        return await self.smp_command(SMPGroup.OS, SMPCmd.OS_ECHO, {"d": message})
        
    async def smp_get_image_state(self):
        """Get firmware image state."""
        return await self.smp_command(SMPGroup.IMAGE, SMPCmd.IMG_STATE)
        
    async def smp_file_write(self, path, data, offset=0):
        """Write data to a file via MCUmgr FS."""
        # FS write command
        payload = {
            "name": path,
            "data": data,
            "off": offset,
        }
        if offset == 0:
            payload["len"] = len(data)
            
        return await self.smp_command(SMPGroup.FS, SMPCmd.FS_FILE, payload)
        
    async def smp_file_read(self, path, offset=0, length=256):
        """Read data from a file via MCUmgr FS."""
        return await self.smp_command(SMPGroup.FS, SMPCmd.FS_FILE, {
            "name": path,
            "off": offset,
            "len": length,
        })
        
    async def custom_write(self, data):
        """Write to the custom service characteristic."""
        print(f"  Writing to custom service: {len(data)} bytes")
        try:
            await self.client.write_gatt_char(UUID_CUSTOM_WRITE, data, response=False)
            return True
        except Exception as e:
            print(f"  Write failed: {e}")
            return False
            
    async def legacy_write(self, data):
        """Write to the legacy FFF2 characteristic."""
        print(f"  Writing to legacy service: {len(data)} bytes")
        try:
            await self.client.write_gatt_char(UUID_LEGACY_WRITE, data, response=False)
            return True
        except Exception as e:
            print(f"  Write failed: {e}")
            return False
            
    async def upload_image_mcumgr(self, image_path):
        """Upload image using MCUmgr filesystem commands."""
        print(f"\n=== Uploading via MCUmgr FS ===")
        
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"Image size: {len(data)} bytes")
        
        # Validate GIF format
        if not (data.startswith(b'GIF89a') or data.startswith(b'GIF87a')):
            print("Warning: File doesn't appear to be a GIF")
            
        # Upload in chunks (MCUmgr has MTU limits)
        chunk_size = 128  # Conservative chunk size
        offset = 0
        
        while offset < len(data):
            chunk = data[offset:offset + chunk_size]
            print(f"  Uploading chunk: offset={offset}, size={len(chunk)}")
            
            result = await self.smp_file_write("/lfs/current.gif", chunk, offset)
            
            if result is None:
                print("  Upload failed!")
                return False
                
            # Check for error
            if isinstance(result, dict) and result.get('rc', 0) != 0:
                print(f"  Error: {result}")
                return False
                
            offset += len(chunk)
            await asyncio.sleep(0.05)  # Small delay between chunks
            
        print(f"Upload complete: {offset} bytes written")
        return True
        
    async def upload_image_custom(self, image_path):
        """Upload image using custom service (experimental)."""
        print(f"\n=== Uploading via Custom Service ===")
        
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"Image size: {len(data)} bytes")
        
        # Try different packet formats
        
        # Format 1: Size header + data
        print("\nTrying format 1: [size:4][data]")
        size_header = struct.pack('<I', len(data))
        await self.custom_write(size_header)
        await asyncio.sleep(0.5)
        
        # Send data in chunks
        chunk_size = 200
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            await self.custom_write(chunk)
            await asyncio.sleep(0.02)
            
        # Wait for response
        await asyncio.sleep(2)
        
        return True
        
    async def test_protocols(self):
        """Test various protocol approaches."""
        print("\n=== Protocol Testing ===\n")
        
        # Test 1: SMP Echo
        print("1. Testing SMP Echo...")
        result = await self.smp_echo("OpenDOTT")
        if result:
            print(f"   ✓ Echo works! Response: {result}")
        else:
            print("   ✗ Echo failed or timed out")
            
        # Test 2: Image State
        print("\n2. Getting Image State...")
        result = await self.smp_get_image_state()
        if result:
            print(f"   ✓ Image state: {result}")
        else:
            print("   ✗ Failed to get image state")
            
        # Test 3: Try reading a file
        print("\n3. Testing FS Read...")
        result = await self.smp_file_read("/lfs/current.gif")
        if result:
            print(f"   ✓ FS read response: {result}")
        else:
            print("   ✗ FS read failed (might be normal)")
            
        # Test 4: Raw write tests
        print("\n4. Testing raw writes...")
        
        test_packets = [
            (b'\x01\x00\x00\x00', "Start marker?"),
            (b'GIF89a', "GIF magic"),
            (struct.pack('<I', 100), "Size header"),
        ]
        
        for packet, desc in test_packets:
            print(f"   Trying: {desc} -> {packet.hex()}")
            await self.custom_write(packet)
            await asyncio.sleep(0.5)
            
            # Check for responses
            while not self.responses.empty():
                name, data = self.responses.get_nowait()
                print(f"   Got response from {name}: {data.hex()}")


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
            print(f"  ✓ DOTT: {d.address} - {name} (RSSI: {d.rssi})")
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
        
        info = await client.get_device_info()
        print("\nDevice Information:")
        for key, value in info.items():
            print(f"  {key}: {value}")
            
        # Try SMP commands
        print("\nTesting SMP...")
        await client.test_protocols()
        
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
        
        # Try MCUmgr FS first
        success = await client.upload_image_mcumgr(image_path)
        
        if not success:
            print("\nMCUmgr failed, trying custom service...")
            await client.upload_image_custom(image_path)
            
    finally:
        await client.disconnect()


async def cmd_test(address):
    """Test connection and protocols."""
    client = DOTTClient(address)
    
    try:
        await client.connect()
        await client.test_protocols()
    finally:
        await client.disconnect()


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
    
    # Auto-scan if no address provided
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
