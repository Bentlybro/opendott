/*
 * OpenDOTT - Minimal Test Firmware
 * Just boots and loops - for testing if hardware config is correct
 */

#include <zephyr/kernel.h>

int main(void)
{
    /* Just loop forever - if we get here, the board boots! */
    while (1) {
        k_sleep(K_SECONDS(1));
    }
    return 0;
}
