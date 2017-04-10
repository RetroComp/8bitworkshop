#include <string.h>

typedef unsigned char byte;
typedef unsigned short word;

// PLATFORM DEFINITION

__sfr __at (0x0) input0;
__sfr __at (0x1) input1;
__sfr __at (0x2) input2;
__sfr __at (0x3) input3;

__sfr __at (0x40) palette;

byte __at (0xe000) cellram[32][32];
byte __at (0xe800) tileram[256][8];

#define LEFT1 !(input1 & 0x10)
#define RIGHT1 !(input1 & 0x20)
#define UP1 !(input1 & 0x40)
#define DOWN1 !(input1 & 0x80)
#define FIRE1 !(input2 & 0x20)
#define COIN1 (input3 & 0x8)
#define START1 !(input2 & 0x10)
#define START2 !(input3 & 0x20)
#define TIMER500HZ (input2 & 0x8)

// GAME DATA

typedef struct {
  byte x;
  byte y;
  byte dir;
  char head_attr;
  char tail_attr;
  char collided:1;
} Player;

Player players[2];

#define FRAMES_PER_MOVE 10

// GAME CODE

void main();

// start routine @ 0x0
void start() {
__asm
  	LD    SP,#0xE800 ; set up stack pointer
        DI		 ; disable interrupts
__endasm;
	main();
}

////////

void delay(byte msec) {
  while (msec--) {
    while (TIMER500HZ != 0) ;
    while (TIMER500HZ == 0) ;
  }
}

#define LOCHAR 0x0
#define HICHAR 0xff
#define CHAR(ch) (ch-LOCHAR)

void clrscr() {
  memset(cellram, CHAR(' '), sizeof(cellram));
}

byte getchar(byte x, byte y) {
  return cellram[x][y];
}

void putchar(byte x, byte y, byte attr) {
  cellram[x][y] = attr;
}

void putstring(byte x, byte y, const char* string) {
  while (*string) {
    putchar(x++, y, (*string++ - LOCHAR));
  }
}

// PC font (code page 437)
const byte font8x8[0x100][8] = {
{ 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 }, { 0x7e,0x81,0x95,0xb1,0xb1,0x95,0x81,0x7e }, { 0x7e,0xff,0xeb,0xcf,0xcf,0xeb,0xff,0x7e }, { 0x0e,0x1f,0x3f,0x7e,0x3f,0x1f,0x0e,0x00 }, { 0x08,0x1c,0x3e,0x7f,0x3e,0x1c,0x08,0x00 }, { 0x38,0x3a,0x9f,0xff,0x9f,0x3a,0x38,0x00 }, { 0x10,0x38,0xbc,0xff,0xbc,0x38,0x10,0x00 }, { 0x00,0x00,0x18,0x3c,0x3c,0x18,0x00,0x00 }, { 0xff,0xff,0xe7,0xc3,0xc3,0xe7,0xff,0xff }, { 0x00,0x3c,0x66,0x42,0x42,0x66,0x3c,0x00 }, { 0xff,0xc3,0x99,0xbd,0xbd,0x99,0xc3,0xff }, { 0x70,0xf8,0x88,0x88,0xfd,0x7f,0x07,0x0f }, { 0x00,0x4e,0x5f,0xf1,0xf1,0x5f,0x4e,0x00 }, { 0xc0,0xe0,0xff,0x7f,0x05,0x05,0x07,0x07 }, { 0xc0,0xff,0x7f,0x05,0x05,0x65,0x7f,0x3f }, { 0x99,0x5a,0x3c,0xe7,0xe7,0x3c,0x5a,0x99 }, { 0x7f,0x3e,0x3e,0x1c,0x1c,0x08,0x08,0x00 }, { 0x08,0x08,0x1c,0x1c,0x3e,0x3e,0x7f,0x00 }, { 0x00,0x24,0x66,0xff,0xff,0x66,0x24,0x00 }, { 0x00,0x5f,0x5f,0x00,0x00,0x5f,0x5f,0x00 }, { 0x06,0x0f,0x09,0x7f,0x7f,0x01,0x7f,0x7f }, { 0xda,0xbf,0xa5,0xa5,0xfd,0x59,0x03,0x02 }, { 0x00,0x70,0x70,0x70,0x70,0x70,0x70,0x00 }, { 0x80,0x94,0xb6,0xff,0xff,0xb6,0x94,0x80 }, { 0x00,0x04,0x06,0x7f,0x7f,0x06,0x04,0x00 }, { 0x00,0x10,0x30,0x7f,0x7f,0x30,0x10,0x00 }, { 0x08,0x08,0x08,0x2a,0x3e,0x1c,0x08,0x00 }, { 0x08,0x1c,0x3e,0x2a,0x08,0x08,0x08,0x00 }, { 0x3c,0x3c,0x20,0x20,0x20,0x20,0x20,0x00 }, { 0x08,0x1c,0x3e,0x08,0x08,0x3e,0x1c,0x08 }, { 0x30,0x38,0x3c,0x3e,0x3e,0x3c,0x38,0x30 }, { 0x06,0x0e,0x1e,0x3e,0x3e,0x1e,0x0e,0x06 }, { 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 }, { 0x00,0x06,0x5f,0x5f,0x06,0x00,0x00,0x00 }, { 0x00,0x07,0x07,0x00,0x07,0x07,0x00,0x00 }, { 0x14,0x7f,0x7f,0x14,0x7f,0x7f,0x14,0x00 }, { 0x24,0x2e,0x6b,0x6b,0x3a,0x12,0x00,0x00 }, { 0x46,0x66,0x30,0x18,0x0c,0x66,0x62,0x00 }, { 0x30,0x7a,0x4f,0x5d,0x37,0x7a,0x48,0x00 }, { 0x04,0x07,0x03,0x00,0x00,0x00,0x00,0x00 }, { 0x00,0x1c,0x3e,0x63,0x41,0x00,0x00,0x00 }, { 0x00,0x41,0x63,0x3e,0x1c,0x00,0x00,0x00 }, { 0x08,0x2a,0x3e,0x1c,0x1c,0x3e,0x2a,0x08 }, { 0x08,0x08,0x3e,0x3e,0x08,0x08,0x00,0x00 }, { 0x00,0xa0,0xe0,0x60,0x00,0x00,0x00,0x00 }, { 0x08,0x08,0x08,0x08,0x08,0x08,0x00,0x00 }, { 0x00,0x00,0x60,0x60,0x00,0x00,0x00,0x00 }, { 0x60,0x30,0x18,0x0c,0x06,0x03,0x01,0x00 }, { 0x3e,0x7f,0x59,0x4d,0x7f,0x3e,0x00,0x00 }, { 0x42,0x42,0x7f,0x7f,0x40,0x40,0x00,0x00 }, { 0x62,0x73,0x59,0x49,0x6f,0x66,0x00,0x00 }, { 0x22,0x63,0x49,0x49,0x7f,0x36,0x00,0x00 }, { 0x18,0x1c,0x16,0x13,0x7f,0x7f,0x10,0x00 }, { 0x27,0x67,0x45,0x45,0x7d,0x39,0x00,0x00 }, { 0x3c,0x7e,0x4b,0x49,0x79,0x30,0x00,0x00 }, { 0x03,0x63,0x71,0x19,0x0f,0x07,0x00,0x00 }, { 0x36,0x7f,0x49,0x49,0x7f,0x36,0x00,0x00 }, { 0x06,0x4f,0x49,0x69,0x3f,0x1e,0x00,0x00 }, { 0x00,0x00,0x6c,0x6c,0x00,0x00,0x00,0x00 }, { 0x00,0xa0,0xec,0x6c,0x00,0x00,0x00,0x00 }, { 0x08,0x1c,0x36,0x63,0x41,0x00,0x00,0x00 }, { 0x14,0x14,0x14,0x14,0x14,0x14,0x00,0x00 }, { 0x00,0x41,0x63,0x36,0x1c,0x08,0x00,0x00 }, { 0x02,0x03,0x51,0x59,0x0f,0x06,0x00,0x00 }, { 0x3e,0x7f,0x41,0x5d,0x5d,0x1f,0x1e,0x00 }, { 0x7c,0x7e,0x13,0x13,0x7e,0x7c,0x00,0x00 }, { 0x41,0x7f,0x7f,0x49,0x49,0x7f,0x36,0x00 }, { 0x1c,0x3e,0x63,0x41,0x41,0x63,0x22,0x00 }, { 0x41,0x7f,0x7f,0x41,0x63,0x7f,0x1c,0x00 }, { 0x41,0x7f,0x7f,0x49,0x5d,0x41,0x63,0x00 }, { 0x41,0x7f,0x7f,0x49,0x1d,0x01,0x03,0x00 }, { 0x1c,0x3e,0x63,0x41,0x51,0x73,0x72,0x00 }, { 0x7f,0x7f,0x08,0x08,0x7f,0x7f,0x00,0x00 }, { 0x00,0x41,0x7f,0x7f,0x41,0x00,0x00,0x00 }, { 0x30,0x70,0x40,0x41,0x7f,0x3f,0x01,0x00 }, { 0x41,0x7f,0x7f,0x08,0x1c,0x77,0x63,0x00 }, { 0x41,0x7f,0x7f,0x41,0x40,0x60,0x70,0x00 }, { 0x7f,0x7f,0x06,0x0c,0x06,0x7f,0x7f,0x00 }, { 0x7f,0x7f,0x06,0x0c,0x18,0x7f,0x7f,0x00 }, { 0x1c,0x3e,0x63,0x41,0x63,0x3e,0x1c,0x00 }, { 0x41,0x7f,0x7f,0x49,0x09,0x0f,0x06,0x00 }, { 0x1e,0x3f,0x21,0x71,0x7f,0x5e,0x00,0x00 }, { 0x41,0x7f,0x7f,0x19,0x39,0x6f,0x46,0x00 }, { 0x26,0x67,0x4d,0x59,0x7b,0x32,0x00,0x00 }, { 0x03,0x41,0x7f,0x7f,0x41,0x03,0x00,0x00 }, { 0x7f,0x7f,0x40,0x40,0x7f,0x7f,0x00,0x00 }, { 0x1f,0x3f,0x60,0x60,0x3f,0x1f,0x00,0x00 }, { 0x7f,0x7f,0x30,0x18,0x30,0x7f,0x7f,0x00 }, { 0x63,0x77,0x1c,0x08,0x1c,0x77,0x63,0x00 }, { 0x07,0x4f,0x78,0x78,0x4f,0x07,0x00,0x00 }, { 0x67,0x73,0x59,0x4d,0x47,0x63,0x71,0x00 }, { 0x00,0x7f,0x7f,0x41,0x41,0x00,0x00,0x00 }, { 0x01,0x03,0x06,0x0c,0x18,0x30,0x60,0x00 }, { 0x00,0x41,0x41,0x7f,0x7f,0x00,0x00,0x00 }, { 0x08,0x0c,0x06,0x03,0x06,0x0c,0x08,0x00 }, { 0x80,0x80,0x80,0x80,0x80,0x80,0x80,0x80 }, { 0x00,0x00,0x03,0x07,0x04,0x00,0x00,0x00 }, { 0x20,0x74,0x54,0x54,0x3c,0x78,0x40,0x00 }, { 0x41,0x3f,0x7f,0x44,0x44,0x7c,0x38,0x00 }, { 0x38,0x7c,0x44,0x44,0x6c,0x28,0x00,0x00 }, { 0x30,0x78,0x48,0x49,0x3f,0x7f,0x40,0x00 }, { 0x38,0x7c,0x54,0x54,0x5c,0x18,0x00,0x00 }, { 0x48,0x7e,0x7f,0x49,0x03,0x02,0x00,0x00 }, { 0x98,0xbc,0xa4,0xa4,0xf8,0x7c,0x04,0x00 }, { 0x41,0x7f,0x7f,0x08,0x04,0x7c,0x78,0x00 }, { 0x00,0x44,0x7d,0x7d,0x40,0x00,0x00,0x00 }, { 0x40,0xc4,0x84,0xfd,0x7d,0x00,0x00,0x00 }, { 0x41,0x7f,0x7f,0x10,0x38,0x6c,0x44,0x00 }, { 0x00,0x41,0x7f,0x7f,0x40,0x00,0x00,0x00 }, { 0x7c,0x7c,0x0c,0x18,0x0c,0x7c,0x78,0x00 }, { 0x7c,0x7c,0x04,0x04,0x7c,0x78,0x00,0x00 }, { 0x38,0x7c,0x44,0x44,0x7c,0x38,0x00,0x00 }, { 0x84,0xfc,0xf8,0xa4,0x24,0x3c,0x18,0x00 }, { 0x18,0x3c,0x24,0xa4,0xf8,0xfc,0x84,0x00 }, { 0x44,0x7c,0x78,0x44,0x1c,0x18,0x00,0x00 }, { 0x48,0x5c,0x54,0x54,0x74,0x24,0x00,0x00 }, { 0x00,0x04,0x3e,0x7f,0x44,0x24,0x00,0x00 }, { 0x3c,0x7c,0x40,0x40,0x3c,0x7c,0x40,0x00 }, { 0x1c,0x3c,0x60,0x60,0x3c,0x1c,0x00,0x00 }, { 0x3c,0x7c,0x60,0x30,0x60,0x7c,0x3c,0x00 }, { 0x44,0x6c,0x38,0x10,0x38,0x6c,0x44,0x00 }, { 0x9c,0xbc,0xa0,0xa0,0xfc,0x7c,0x00,0x00 }, { 0x4c,0x64,0x74,0x5c,0x4c,0x64,0x00,0x00 }, { 0x08,0x08,0x3e,0x77,0x41,0x41,0x00,0x00 }, { 0x00,0x00,0x00,0x77,0x77,0x00,0x00,0x00 }, { 0x41,0x41,0x77,0x3e,0x08,0x08,0x00,0x00 }, { 0x02,0x03,0x01,0x03,0x02,0x03,0x01,0x00 }, { 0x78,0x7c,0x46,0x43,0x46,0x7c,0x78,0x00 }, { 0x0e,0x9f,0x91,0xb1,0xfb,0x4a,0x00,0x00 }, { 0x3a,0x7a,0x40,0x40,0x7a,0x7a,0x40,0x00 }, { 0x38,0x7c,0x54,0x55,0x5d,0x19,0x00,0x00 }, { 0x02,0x23,0x75,0x55,0x55,0x7d,0x7b,0x42 }, { 0x21,0x75,0x54,0x54,0x7d,0x79,0x40,0x00 }, { 0x21,0x75,0x55,0x54,0x7c,0x78,0x40,0x00 }, { 0x20,0x74,0x57,0x57,0x7c,0x78,0x40,0x00 }, { 0x18,0x3c,0xa4,0xa4,0xa4,0xe4,0x40,0x00 }, { 0x02,0x3b,0x7d,0x55,0x55,0x5d,0x1b,0x02 }, { 0x39,0x7d,0x54,0x54,0x5d,0x19,0x00,0x00 }, { 0x39,0x7d,0x55,0x54,0x5c,0x18,0x00,0x00 }, { 0x01,0x45,0x7c,0x7c,0x41,0x01,0x00,0x00 }, { 0x02,0x03,0x45,0x7d,0x7d,0x43,0x02,0x00 }, { 0x01,0x45,0x7d,0x7c,0x40,0x00,0x00,0x00 }, { 0x79,0x7d,0x26,0x26,0x7d,0x79,0x00,0x00 }, { 0x70,0x78,0x2b,0x2b,0x78,0x70,0x00,0x00 }, { 0x44,0x7c,0x7c,0x55,0x55,0x45,0x00,0x00 }, { 0x20,0x74,0x54,0x54,0x7c,0x7c,0x54,0x54 }, { 0x7c,0x7e,0x0b,0x09,0x7f,0x7f,0x49,0x00 }, { 0x32,0x7b,0x49,0x49,0x7b,0x32,0x00,0x00 }, { 0x32,0x7a,0x48,0x48,0x7a,0x32,0x00,0x00 }, { 0x32,0x7a,0x4a,0x48,0x78,0x30,0x00,0x00 }, { 0x3a,0x7b,0x41,0x41,0x7b,0x7a,0x40,0x00 }, { 0x3a,0x7a,0x42,0x40,0x78,0x78,0x40,0x00 }, { 0xba,0xba,0xa0,0xa0,0xfa,0x7a,0x00,0x00 }, { 0x19,0x3d,0x66,0x66,0x66,0x3d,0x19,0x00 }, { 0x3d,0x7d,0x40,0x40,0x7d,0x3d,0x00,0x00 }, { 0x18,0x3c,0x24,0xe7,0xe7,0x24,0x24,0x00 }, { 0x68,0x7e,0x7f,0x49,0x43,0x66,0x20,0x00 }, { 0x2b,0x2f,0x7c,0x7c,0x2f,0x2b,0x00,0x00 }, { 0x7f,0x7f,0x09,0x2f,0xf6,0xf8,0xa0,0x00 }, { 0x40,0xc8,0x88,0xfe,0x7f,0x09,0x0b,0x02 }, { 0x20,0x74,0x54,0x55,0x7d,0x79,0x40,0x00 }, { 0x00,0x44,0x7d,0x7d,0x41,0x00,0x00,0x00 }, { 0x30,0x78,0x48,0x4a,0x7a,0x32,0x00,0x00 }, { 0x38,0x78,0x40,0x42,0x7a,0x7a,0x40,0x00 }, { 0x7a,0x7a,0x0a,0x0a,0x7a,0x70,0x00,0x00 }, { 0x7d,0x7d,0x19,0x31,0x7d,0x7d,0x00,0x00 }, { 0x00,0x26,0x2f,0x29,0x2f,0x2f,0x28,0x00 }, { 0x00,0x26,0x2f,0x29,0x29,0x2f,0x26,0x00 }, { 0x30,0x78,0x4d,0x45,0x60,0x20,0x00,0x00 }, { 0x38,0x38,0x08,0x08,0x08,0x08,0x00,0x00 }, { 0x08,0x08,0x08,0x08,0x38,0x38,0x00,0x00 }, { 0x67,0x37,0x18,0xcc,0xee,0xab,0xb9,0x90 }, { 0x6f,0x3f,0x18,0x4c,0x66,0x73,0xf9,0xf8 }, { 0x00,0x00,0x60,0xfa,0xfa,0x60,0x00,0x00 }, { 0x08,0x1c,0x36,0x22,0x08,0x1c,0x36,0x22 }, { 0x22,0x36,0x1c,0x08,0x22,0x36,0x1c,0x08 }, { 0xaa,0x00,0x55,0x00,0xaa,0x00,0x55,0x00 }, { 0xaa,0x55,0xaa,0x55,0xaa,0x55,0xaa,0x55 }, { 0x55,0xff,0xaa,0xff,0x55,0xff,0xaa,0xff }, { 0x00,0x00,0x00,0xff,0xff,0x00,0x00,0x00 }, { 0x10,0x10,0x10,0xff,0xff,0x00,0x00,0x00 }, { 0x14,0x14,0x14,0xff,0xff,0x00,0x00,0x00 }, { 0x10,0x10,0xff,0xff,0x00,0xff,0xff,0x00 }, { 0x10,0x10,0xf0,0xf0,0x10,0xf0,0xf0,0x00 }, { 0x14,0x14,0x14,0xfc,0xfc,0x00,0x00,0x00 }, { 0x14,0x14,0xf7,0xf7,0x00,0xff,0xff,0x00 }, { 0x00,0x00,0xff,0xff,0x00,0xff,0xff,0x00 }, { 0x14,0x14,0xf4,0xf4,0x04,0xfc,0xfc,0x00 }, { 0x14,0x14,0x17,0x17,0x10,0x1f,0x1f,0x00 }, { 0x10,0x10,0x1f,0x1f,0x10,0x1f,0x1f,0x00 }, { 0x14,0x14,0x14,0x1f,0x1f,0x00,0x00,0x00 }, { 0x10,0x10,0x10,0xf0,0xf0,0x00,0x00,0x00 }, { 0x00,0x00,0x00,0x1f,0x1f,0x10,0x10,0x10 }, { 0x10,0x10,0x10,0x1f,0x1f,0x10,0x10,0x10 }, { 0x10,0x10,0x10,0xf0,0xf0,0x10,0x10,0x10 }, { 0x00,0x00,0x00,0xff,0xff,0x10,0x10,0x10 }, { 0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x10 }, { 0x10,0x10,0x10,0xff,0xff,0x10,0x10,0x10 }, { 0x00,0x00,0x00,0xff,0xff,0x14,0x14,0x14 }, { 0x00,0x00,0xff,0xff,0x00,0xff,0xff,0x10 }, { 0x00,0x00,0x1f,0x1f,0x10,0x17,0x17,0x14 }, { 0x00,0x00,0xfc,0xfc,0x04,0xf4,0xf4,0x14 }, { 0x14,0x14,0x17,0x17,0x10,0x17,0x17,0x14 }, { 0x14,0x14,0xf4,0xf4,0x04,0xf4,0xf4,0x14 }, { 0x00,0x00,0xff,0xff,0x00,0xf7,0xf7,0x14 }, { 0x14,0x14,0x14,0x14,0x14,0x14,0x14,0x14 }, { 0x14,0x14,0xf7,0xf7,0x00,0xf7,0xf7,0x14 }, { 0x14,0x14,0x14,0x17,0x17,0x14,0x14,0x14 }, { 0x10,0x10,0x1f,0x1f,0x10,0x1f,0x1f,0x10 }, { 0x14,0x14,0x14,0xf4,0xf4,0x14,0x14,0x14 }, { 0x10,0x10,0xf0,0xf0,0x10,0xf0,0xf0,0x10 }, { 0x00,0x00,0x1f,0x1f,0x10,0x1f,0x1f,0x10 }, { 0x00,0x00,0x00,0x1f,0x1f,0x14,0x14,0x14 }, { 0x00,0x00,0x00,0xfc,0xfc,0x14,0x14,0x14 }, { 0x00,0x00,0xf0,0xf0,0x10,0xf0,0xf0,0x10 }, { 0x10,0x10,0xff,0xff,0x00,0xff,0xff,0x10 }, { 0x14,0x14,0x14,0xf7,0xf7,0x14,0x14,0x14 }, { 0x10,0x10,0x10,0x1f,0x1f,0x00,0x00,0x00 }, { 0x00,0x00,0x00,0xf0,0xf0,0x10,0x10,0x10 }, { 0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff }, { 0xf0,0xf0,0xf0,0xf0,0xf0,0xf0,0xf0,0xf0 }, { 0xff,0xff,0xff,0xff,0x00,0x00,0x00,0x00 }, { 0x00,0x00,0x00,0x00,0xff,0xff,0xff,0xff }, { 0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f,0x0f }, { 0x38,0x7c,0x44,0x6c,0x38,0x6c,0x44,0x00 }, { 0xfc,0xfe,0x2a,0x2a,0x3e,0x14,0x00,0x00 }, { 0x7e,0x7e,0x02,0x02,0x02,0x06,0x06,0x00 }, { 0x02,0x7e,0x7e,0x02,0x7e,0x7e,0x02,0x00 }, { 0x41,0x63,0x77,0x5d,0x49,0x63,0x63,0x00 }, { 0x38,0x7c,0x44,0x44,0x7c,0x3c,0x04,0x00 }, { 0x80,0xfe,0x7e,0x20,0x20,0x3e,0x1e,0x00 }, { 0x04,0x06,0x02,0x7e,0x7c,0x06,0x02,0x00 }, { 0x99,0xbd,0xe7,0xe7,0xbd,0x99,0x00,0x00 }, { 0x1c,0x3e,0x6b,0x49,0x6b,0x3e,0x1c,0x00 }, { 0x4c,0x7e,0x73,0x01,0x73,0x7e,0x4c,0x00 }, { 0x30,0x78,0x4a,0x4f,0x7d,0x39,0x00,0x00 }, { 0x18,0x3c,0x24,0x3c,0x3c,0x24,0x3c,0x18 }, { 0x98,0xfc,0x64,0x3c,0x3e,0x27,0x3d,0x18 }, { 0x1c,0x3e,0x6b,0x49,0x49,0x49,0x00,0x00 }, { 0x7e,0x7f,0x01,0x01,0x7f,0x7e,0x00,0x00 }, { 0x2a,0x2a,0x2a,0x2a,0x2a,0x2a,0x00,0x00 }, { 0x44,0x44,0x5f,0x5f,0x44,0x44,0x00,0x00 }, { 0x40,0x51,0x5b,0x4e,0x44,0x40,0x00,0x00 }, { 0x40,0x44,0x4e,0x5b,0x51,0x40,0x00,0x00 }, { 0x00,0x00,0x00,0xfe,0xff,0x01,0x07,0x06 }, { 0x60,0xe0,0x80,0xff,0x7f,0x00,0x00,0x00 }, { 0x08,0x08,0x6b,0x6b,0x08,0x08,0x00,0x00 }, { 0x24,0x12,0x12,0x36,0x24,0x24,0x12,0x00 }, { 0x00,0x06,0x0f,0x09,0x0f,0x06,0x00,0x00 }, { 0x00,0x00,0x00,0x18,0x18,0x00,0x00,0x00 }, { 0x00,0x00,0x00,0x10,0x10,0x00,0x00,0x00 }, { 0x10,0x30,0x70,0xc0,0xff,0xff,0x01,0x01 }, { 0x00,0x1f,0x1f,0x01,0x1f,0x1e,0x00,0x00 }, { 0x00,0x19,0x1d,0x15,0x17,0x12,0x00,0x00 }, { 0x00,0x00,0x3c,0x3c,0x3c,0x3c,0x00,0x00 }, { 0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00 }
};

const char BOX_CHARS[8] = { 218, 191, 192, 217, 196, 196, 179, 179 };

void draw_box(byte x, byte y, byte x2, byte y2, const char chars[]) {
  byte x1 = x;
  putchar(x, y, chars[2]);
  putchar(x2, y, chars[3]);
  putchar(x, y2, chars[0]);
  putchar(x2, y2, chars[1]);
  while (++x < x2) {
    putchar(x, y, chars[5]);
    putchar(x, y2, chars[4]);
  }
  while (++y < y2) {
    putchar(x1, y, chars[6]);
    putchar(x2, y, chars[7]);
  }
}

void draw_playfield() {
  draw_box(0,0,27,29,BOX_CHARS);
}

typedef enum { D_RIGHT, D_DOWN, D_LEFT, D_UP } Direction;
const char DIR_X[4] = { 1, 0, -1, 0 };
const char DIR_Y[4] = { 0, -1, 0, 1 };

void init_game() {
  memset(players, 0, sizeof(players));
  players[0].head_attr = CHAR('1');
  players[1].head_attr = CHAR('2');
  players[0].tail_attr = 254;
  players[1].tail_attr = 254;
}

void reset_players() {
  players[0].x = players[0].y = 6;
  players[0].dir = D_RIGHT;
  players[1].x = players[1].y = 21;
  players[1].dir = D_LEFT;
  players[0].collided = players[1].collided = 0;
}

void draw_player(byte p) {
  putchar(players[p].x, players[p].y, players[p].head_attr);
}

void erase_player(byte p) {
  putchar(players[p].x, players[p].y, players[p].tail_attr);
}

void move_player(byte p) {
  erase_player(p);
  players[p].x += DIR_X[players[p].dir];
  players[p].y += DIR_Y[players[p].dir];
  if (getchar(players[p].x, players[p].y) != CHAR(' '))
    players[p].collided = 1;
  draw_player(p);
}

void human_control(byte p) {
  Direction dir = 0xff;
  if (LEFT1) dir = D_LEFT;
  if (RIGHT1) dir = D_RIGHT;
  if (UP1) dir = D_UP;
  if (DOWN1) dir = D_DOWN;
  // don't let the player reverse
  if (dir != 0xff && dir != (players[p].dir ^ 2)) {
    players[p].dir = dir;
  }
}

void ai_control(byte p) {
  byte x,y;
  Direction dir = players[p].dir;
  x = players[p].x + DIR_X[dir];
  y = players[p].y + DIR_Y[dir];
  if (getchar(x,y) != CHAR(' ')) {
    players[p].dir = (dir + 1) & 3;
  }
}

void flash_colliders() {
  byte i;
  // flash players that collided
  for (i=0; i<60; i++) {
    if (players[0].collided) players[0].head_attr ^= 0x80;
    if (players[1].collided) players[1].head_attr ^= 0x80;
    delay(5);
    draw_player(0);
    draw_player(1);
    palette = i;
  }
  palette = 0;
}

void make_move() {
  byte i;
  for (i=0; i<FRAMES_PER_MOVE; i++) {
    human_control(0);
    delay(10);
  }
  ai_control(1);
  // if players collide, 2nd player gets the point
  move_player(1);
  move_player(0);
}

void play_round() {
  reset_players();
  clrscr();
  draw_playfield();
  while (1) {
    make_move();
    if (players[0].collided || players[1].collided) break;
  }
  flash_colliders();
}

void main() {
  palette = 0;
  memcpy(tileram, font8x8, sizeof(font8x8));
  draw_playfield();
  while (1) {
    init_game();
    play_round();
  }
}
