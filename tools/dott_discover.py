#!/usr/bin/env python3
"""
DOTT Service Discovery
======================
Enumerate ALL BLE services and characteristics on the DOTT device.

Usage:
    python dott_discover.py
    python dott_discover.py -a E2:E2:B4:44:D5:30
"""

import asyncio
import argparse
import sys

try:
    from bleak import BleakClient, BleakScanner
except ImportError:
    print("Error: bleak not installed. Run: pip install bleak")
    sys.exit(1)


# Known UUIDs for reference
KNOWN_UUIDS = {
    # Standard services
    "00001800-0000-1000-8000-00805f9b34fb": "Generic Access",
    "00001801-0000-1000-8000-00805f9b34fb": "Generic Attribute", 
    "0000180a-0000-1000-8000-00805f9b34fb": "Device Information",
    "0000180f-0000-1000-8000-00805f9b34fb": "Battery Service",
    
    # Standard characteristics
    "00002a00-0000-1000-8000-00805f9b34fb": "Device Name",
    "00002a01-0000-1000-8000-00805f9b34fb": "Appearance",
    "00002a04-0000-1000-8000-00805f9b34fb": "Peripheral Preferred Connection Parameters",
    "00002a05-0000-1000-8000-00805f9b34fb": "Service Changed",
    "00002a19-0000-1000-8000-00805f9b34fb": "Battery Level",
    "00002a24-0000-1000-8000-00805f9b34fb": "Model Number String",
    "00002a26-0000-1000-8000-00805f9b34fb": "Firmware Revision String",
    "00002a29-0000-1000-8000-00805f9b34fb": "Manufacturer Name String",
    "00002a50-0000-1000-8000-00805f9b34fb": "PnP ID",
    "00002b29-0000-1000-8000-00805f9b34fb": "Client Supported Features",
    "00002b2a-0000-1000-8000-00805f9b34fb": "Database Hash",
    
    # MCUmgr SMP
    "8d53dc1d-1db7-4cd3-868b-8a527460aa84": "MCUmgr SMP Service",
    "da2e7828-fbce-4e01-ae9e-261174997c48": "SMP Characteristic",
    
    # Custom (what we expected)
    "0000fff0-0000-1000-8000-00805f9b34fb": "Custom Service (FFF0)",
    "0000fff1-0000-1000-8000-00805f9b34fb": "Custom Notify (FFF1)",
    "0000fff2-0000-1000-8000-00805f9b34fb": "Custom Write (FFF2)",
    "f000ffe0-0451-4000-b000-000000000000": "TI Custom Service",
    "f000ffe1-0451-4000-b000-000000000000": "TI Custom Write",
    "f000ffe2-0451-4000-b000-000000000000": "TI Custom Notify",
}


def get_uuid_name(uuid):
    """Get human-readable name for UUID if known."""
    uuid_lower = str(uuid).lower()
    return KNOWN_UUIDS.get(uuid_lower, "")


def format_properties(props):
    """Format characteristic properties."""
    prop_map = {
        'read': 'R',
        'write': 'W',
        'write-without-response': 'W-',
        'notify': 'N',
        'indicate': 'I',
        'broadcast': 'B',
    }
    return ''.join(prop_map.get(p, p[0].upper()) for p in props)


async def discover_services(address):
    """Discover and print all services and characteristics."""
    print(f"\nConnecting to {address}...")
    
    async with BleakClient(address) as client:
        print(f"Connected: {client.is_connected}")
        print(f"\n{'='*70}")
        print("SERVICE DISCOVERY")
        print('='*70)
        
        services = client.services
        
        for service in services:
            svc_name = get_uuid_name(service.uuid)
            print(f"\n[SERVICE] {service.uuid}")
            if svc_name:
                print(f"          └─ {svc_name}")
                
            for char in service.characteristics:
                char_name = get_uuid_name(char.uuid)
                props = format_properties(char.properties)
                
                print(f"    [CHAR] {char.uuid}")
                print(f"           Props: [{props}] {list(char.properties)}")
                if char_name:
                    print(f"           Name: {char_name}")
                    
                # Try to read if readable
                if 'read' in char.properties:
                    try:
                        value = await client.read_gatt_char(char.uuid)
                        # Try to decode as string
                        try:
                            decoded = value.decode('utf-8')
                            print(f"           Value: \"{decoded}\"")
                        except:
                            print(f"           Value: {value.hex()} ({len(value)} bytes)")
                    except Exception as e:
                        print(f"           Value: <read error: {e}>")
                        
                # Show descriptors
                for desc in char.descriptors:
                    print(f"      [DESC] {desc.uuid}")
                    
        print(f"\n{'='*70}")
        print("SUMMARY")
        print('='*70)
        
        # Print summary of custom/unknown services
        print("\nCustom/Unknown Services:")
        for service in services:
            uuid = str(service.uuid).lower()
            # Skip standard Bluetooth SIG services (0000xxxx-0000-1000-8000-00805f9b34fb)
            if not uuid.startswith("0000") or not uuid.endswith("-0000-1000-8000-00805f9b34fb"):
                if "8d53dc1d" not in uuid:  # Skip MCUmgr (we know about it)
                    print(f"  {service.uuid}")
                    for char in service.characteristics:
                        props = format_properties(char.properties)
                        print(f"    └─ {char.uuid} [{props}]")


async def scan_for_dott():
    """Scan for DOTT devices."""
    print("Scanning for DOTT devices...")
    devices = await BleakScanner.discover(timeout=5.0)
    
    for d in devices:
        name = d.name or "Unknown"
        if "dott" in name.lower():
            print(f"Found: {d.address} - {name}")
            return d.address
            
    print("No DOTT device found")
    return None


async def main():
    parser = argparse.ArgumentParser(description="DOTT Service Discovery")
    parser.add_argument('-a', '--address', help='Device address')
    args = parser.parse_args()
    
    address = args.address or await scan_for_dott()
    if not address:
        return
        
    await discover_services(address)


if __name__ == '__main__':
    asyncio.run(main())
