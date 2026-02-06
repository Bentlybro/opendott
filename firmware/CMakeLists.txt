# SPDX-License-Identifier: MIT

cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(opendott)

# MINIMAL TEST - just main.c
target_sources(app PRIVATE
    src/main.c
)

# Full build (uncomment when minimal works):
# target_sources(app PRIVATE
#     src/main.c
#     src/display.c
#     src/storage.c
#     src/ble_service.c
#     src/image_handler.c
#     src/button.c
# )

target_include_directories(app PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)
