#!/usr/bin/env python3
"""
DOTT Image Upload Tool
======================
Upload images to DOTT wearable via Bluetooth LE.

Protocol discovered via BLE service enumeration:
- Custom Service: 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc
- Data Transfer: characteristic 0x1529 (write + notify)
- Status: characteristic 0x1527

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
# BLE UUIDs - DISCOVERED FROM DEVICE
# ============================================================================

# Standard Services
UUID_BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"
UUID_DEVICE_NAME = "00002a00-0000-1000-8000-00805f9b34fb"
UUID_FIRMWARE_REV = "00002a26-0000-1000-8000-00805f9b34fb"
UUID_MODEL_NUMBER = "00002a24-0000-1000-8000-00805f9b34fb"

# MCUmgr SMP Service (for firmware updates)
UUID_SMP_SERVICE = "8d53dc1d-1db7-4cd3-868b-8a527460aa84"
UUID_SMP_CHAR = "da2e7828-fbce-4e01-ae9e-261174997c48"

# ============================================================================
# DOTT IMAGE TRANSFER SERVICE (discovered)
# Service UUID: 0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc
# ============================================================================
UUID_DOTT_SERVICE = "0483dadd-6c9d-6ca9-5d41-03ad4fff4bcc"

# Characteristics (using 16-bit form for readability)
# Full form: 0000XXXX-0000-1000-8000-00805f9b34fb
UUID_DOTT_STATE     = "00001525-0000-1000-8000-00805f9b34fb"  # RW- State/CBOR data
UUID_DOTT_COMMAND   = "00001526-0000-1000-8000-00805f9b34fb"  # RW  Command
UUID_DOTT_STATUS    = "00001527-0000-1000-8000-00805f9b34fb"  # RW  Status byte
UUID_DOTT_ACK       = "00001528-0000-1000-8000-00805f9b34fb"  # RWI ACK (indicate)
UUID_DOTT_DATA      = "00001529-0000-1000-8000-00805f9b34fb"  # WN  DATA TRANSFER
UUID_DOTT_RESPONSE  = "00001530-0000-1000-8000-00805f9b34fb"  # RN  Response

# Legacy UUIDs (not present on device but kept for reference)
UUID_CUSTOM_SERVICE = "f000ffe0-0451-4000-b000-000000000000"  # TI-style - NOT USED
UUID_LEGACY_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb"  # FFF0 - NOT USED

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
    OS_ECHO = 0
    OS_RESET = 5
    FS_FILE = 0
    IMG_STATE = 0
    IMG_UPLOAD = 1


def build_smp_packet(op, group, cmd_id, data=None, seq=0):
    """Build an SMP packet with CBOR payload."""
    if data is None:
        data = {}
    
    if cbor2 is None:
        raise RuntimeError("cbor2 not installed")
    
    payload = cbor2.dumps(data)
    header = struct.pack('>BBHHBB', op, 0, len(payload), group, seq, cmd_id)
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
    
    return {'op': op, 'group': group, 'cmd': cmd, 'seq': seq}, result, data[8+length:]


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
        self.has_dott_service = False
        self.has_smp_service = False
        
    async def connect(self):
        """Connect to DOTT device."""
        print(f"Connecting to {self.address}...")
        self.client = BleakClient(self.address)
        await self.client.connect()
        self.connected = True
        print(f"Connected: {self.client.is_connected}")
        
        # Check available services
        await self._check_services()
        
        # Enable notifications
        await self._setup_notifications()
        
    async def disconnect(self):
        """Disconnect from device."""
        if self.client and self.client.is_connected:
            await self.client.disconnect()
        self.connected = False
        print("Disconnected")
        
    async def _check_services(self):
        """Check which services are available."""
        for service in self.client.services:
            if service.uuid.lower() == UUID_DOTT_SERVICE.lower():
                self.has_dott_service = True
                print(f"  ✓ DOTT Image Service found")
            elif service.uuid.lower() == UUID_SMP_SERVICE.lower():
                self.has_smp_service = True
                print(f"  ✓ MCUmgr SMP Service found")
                
    async def _setup_notifications(self):
        """Enable notifications on response characteristics."""
        
        def make_handler(name):
            def handler(sender, data):
                print(f"[{name}] Notification ({len(data)} bytes): {data[:32].hex()}{'...' if len(data) > 32 else ''}")
                self.responses.put_nowait((name, data))
            return handler
        
        # DOTT service notifications
        notify_chars = [
            (UUID_DOTT_DATA, "DOTT_DATA"),       # 0x1529 - write+notify
            (UUID_DOTT_ACK, "DOTT_ACK"),         # 0x1528 - indicate
            (UUID_DOTT_RESPONSE, "DOTT_RESP"),   # 0x1530 - notify
            (UUID_SMP_CHAR, "SMP"),              # MCUmgr
        ]
        
        for uuid, name in notify_chars:
            try:
                await self.client.start_notify(uuid, make_handler(name))
                print(f"  ✓ Notifications enabled: {name}")
            except Exception as e:
                # Not all chars may support notifications
                pass
                
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
        
    async def read_dott_status(self):
        """Read DOTT service status characteristics."""
        status = {}
        
        try:
            data = await self.client.read_gatt_char(UUID_DOTT_STATUS)
            status['status_byte'] = data[0] if data else None
            print(f"  Status (0x1527): {data.hex() if data else 'empty'}")
        except Exception as e:
            print(f"  Status read failed: {e}")
            
        try:
            data = await self.client.read_gatt_char(UUID_DOTT_COMMAND)
            status['command'] = data
            print(f"  Command (0x1526): {data.hex() if data else 'empty'}")
        except Exception as e:
            print(f"  Command read failed: {e}")
            
        try:
            data = await self.client.read_gatt_char(UUID_DOTT_RESPONSE)
            status['response'] = data
            print(f"  Response (0x1530): {data[:32].hex() if data else 'empty'}{'...' if data and len(data) > 32 else ''}")
        except Exception as e:
            print(f"  Response read failed: {e}")
            
        return status
        
    async def smp_command(self, group, cmd, data=None, timeout=5.0):
        """Send an SMP command and wait for response."""
        self.smp_seq = (self.smp_seq + 1) % 256
        packet = build_smp_packet(SMPOp.WRITE, group, cmd, data, self.smp_seq)
        
        print(f"  Sending SMP: group={group}, cmd={cmd}")
        
        try:
            await self.client.write_gatt_char(UUID_SMP_CHAR, packet, response=False)
        except Exception as e:
            print(f"  Write failed: {e}")
            return None
            
        try:
            name, response = await asyncio.wait_for(self.responses.get(), timeout)
            header, result, _ = parse_smp_response(response)
            return result
        except asyncio.TimeoutError:
            print("  Timeout")
            return None
            
    async def smp_echo(self, message="OpenDOTT"):
        """Test SMP with echo command."""
        return await self.smp_command(SMPGroup.OS, SMPCmd.OS_ECHO, {"d": message})
        
    async def smp_get_image_state(self):
        """Get firmware image state."""
        return await self.smp_command(SMPGroup.IMAGE, SMPCmd.IMG_STATE)
        
    # ========================================================================
    # DOTT Image Transfer Protocol
    # ========================================================================
    
    async def write_dott_data(self, data, response_wait=True):
        """Write data to the DOTT data characteristic (0x1529)."""
        try:
            # write-without-response for speed
            await self.client.write_gatt_char(UUID_DOTT_DATA, data, response=False)
            return True
        except Exception as e:
            print(f"  Write failed: {e}")
            return False
            
    async def write_dott_command(self, data):
        """Write to the DOTT command characteristic (0x1526)."""
        try:
            await self.client.write_gatt_char(UUID_DOTT_COMMAND, data, response=True)
            return True
        except Exception as e:
            print(f"  Command write failed: {e}")
            return False
            
    async def upload_image_dott(self, image_path):
        """Upload image using discovered DOTT protocol."""
        print(f"\n{'='*60}")
        print(f"DOTT Image Upload")
        print(f"{'='*60}\n")
        
        if not self.has_dott_service:
            print("Error: DOTT service not found on device!")
            return False
            
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"File: {image_path}")
        print(f"Size: {len(data)} bytes")
        
        # Validate GIF
        if data.startswith(b'GIF89a') or data.startswith(b'GIF87a'):
            print(f"Format: GIF ✓")
        else:
            print(f"Warning: Not a GIF file! First bytes: {data[:6].hex()}")
            
        # Read initial status
        print(f"\nReading initial status...")
        await self.read_dott_status()
        
        # Based on firmware analysis, the protocol seems to be:
        # 1. Send size/trigger command
        # 2. Stream data chunks
        # 3. Wait for processing
        
        print(f"\n--- Starting Transfer ---\n")
        
        # Try Protocol A: Direct data streaming to 0x1529
        print("Protocol A: Direct data stream to 0x1529")
        
        # Send total size first (4 bytes little-endian)
        size_header = struct.pack('<I', len(data))
        print(f"  Sending size header: {size_header.hex()} ({len(data)} bytes)")
        await self.write_dott_data(size_header)
        await asyncio.sleep(0.2)
        
        # Stream data in chunks (BLE MTU is typically 20-244 bytes, use conservative 200)
        chunk_size = 200
        total_chunks = (len(data) + chunk_size - 1) // chunk_size
        
        for i in range(0, len(data), chunk_size):
            chunk = data[i:i+chunk_size]
            chunk_num = i // chunk_size + 1
            
            if chunk_num % 10 == 0 or chunk_num == total_chunks:
                print(f"  Chunk {chunk_num}/{total_chunks} ({len(chunk)} bytes)")
                
            await self.write_dott_data(chunk)
            await asyncio.sleep(0.01)  # Small delay between chunks
            
            # Check for any notifications
            while not self.responses.empty():
                name, resp = self.responses.get_nowait()
                print(f"    Response: {name} = {resp.hex()}")
                
        print(f"\n  All data sent: {len(data)} bytes")
        
        # Wait a bit for processing and check status
        print(f"\n  Waiting for device to process...")
        await asyncio.sleep(2)
        
        # Drain any remaining notifications
        while not self.responses.empty():
            name, resp = self.responses.get_nowait()
            print(f"  Response: {name} = {resp.hex()}")
            
        # Read final status
        print(f"\nFinal status:")
        await self.read_dott_status()
        
        return True
        
    async def upload_image_alt(self, image_path):
        """Alternative upload - try different packet formats."""
        print(f"\n{'='*60}")
        print(f"Alternative Upload Protocol Test")
        print(f"{'='*60}\n")
        
        with open(image_path, 'rb') as f:
            data = f.read()
            
        print(f"Testing alternative packet formats...\n")
        
        # Protocol B: Command characteristic first
        print("Protocol B: Command trigger + data stream")
        print("  Writing trigger to 0x1526...")
        await self.write_dott_command(struct.pack('<I', len(data)))
        await asyncio.sleep(0.5)
        
        # Check for response
        while not self.responses.empty():
            name, resp = self.responses.get_nowait()
            print(f"  Response: {name} = {resp.hex()}")
            
        # Stream first 2KB as test
        test_size = min(2048, len(data))
        chunk_size = 200
        
        for i in range(0, test_size, chunk_size):
            chunk = data[i:i+chunk_size]
            await self.write_dott_data(chunk)
            await asyncio.sleep(0.01)
            
        print(f"  Sent {test_size} bytes test data")
        await asyncio.sleep(1)
        
        while not self.responses.empty():
            name, resp = self.responses.get_nowait()
            print(f"  Response: {name} = {resp.hex()}")
            
        # Protocol C: Framed packets with sequence numbers
        print("\nProtocol C: Framed packets [seq:2][len:2][data]")
        
        # Reset by reading status
        await self.read_dott_status()
        
        seq = 0
        chunk_size = 196  # Leave room for header
        test_size = min(2048, len(data))
        
        for i in range(0, test_size, chunk_size):
            chunk = data[i:i+chunk_size]
            # Frame: [seq:2 LE][len:2 LE][data]
            frame = struct.pack('<HH', seq, len(chunk)) + chunk
            await self.write_dott_data(frame)
            seq += 1
            await asyncio.sleep(0.01)
            
        print(f"  Sent {seq} framed packets")
        await asyncio.sleep(1)
        
        while not self.responses.empty():
            name, resp = self.responses.get_nowait()
            print(f"  Response: {name} = {resp.hex()}")
            
        return True
        
    async def test_protocols(self):
        """Test all available protocols."""
        print("\n" + "="*60)
        print("Protocol Testing")
        print("="*60 + "\n")
        
        # Device info
        info = await self.get_device_info()
        print("Device Info:")
        for k, v in info.items():
            print(f"  {k}: {v}")
            
        # DOTT service status
        if self.has_dott_service:
            print(f"\nDOTT Service Status:")
            await self.read_dott_status()
        else:
            print("\nDOTT Service: NOT FOUND")
            
        # SMP test
        if self.has_smp_service:
            print(f"\nSMP Echo Test:")
            result = await self.smp_echo("OpenDOTT")
            if result:
                print(f"  ✓ Echo response: {result}")
            else:
                print(f"  ✗ No response")
                
            print(f"\nSMP Image State:")
            result = await self.smp_get_image_state()
            if result:
                print(f"  ✓ Response: {result}")
        else:
            print("\nSMP Service: NOT FOUND")


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
        await client.upload_image_dott(image_path)
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
