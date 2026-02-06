/*
 * OpenDOTT - Main Application
 * SPDX-License-Identifier: MIT
 * 
 * MINIMAL TEST VERSION - just boot and loop
 * If the display stays black after flash, this firmware booted successfully!
 */

#include <zephyr/kernel.h>

int main(void)
{
    /* If we reach here, the nRF52840 boots with our config! */
    /* The display will go black (no display init) but that proves we're running */
    
    while (1) {
        k_sleep(K_SECONDS(1));
    }
    
    return 0;
}
