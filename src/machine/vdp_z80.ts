
import { Z80, Z80State } from "../cpu/ZilogZ80";
import { BasicScanlineMachine, Bus } from "../devices";
import { newAddressDecoder, newKeyboardHandler } from "../emu";
import { TssChannelAdapter } from "../audio";
import { TMS9918A } from "../video/tms9918a";

const audioOversample = 2;

export abstract class BaseZ80VDPBasedMachine extends BasicScanlineMachine {

  cpuFrequency = 3579545; // MHz
  canvasWidth = 304;
  numTotalScanlines = 262;
  numVisibleScanlines = 240;
  cpuCyclesPerLine = this.cpuFrequency / (262*60);
  sampleRate = 262*60*audioOversample;
  overscan = true;

  cpu: Z80 = new Z80();
  vdp: TMS9918A;
  psg;
  handler;
  audioadapter;

  abstract vdpInterrupt();
  abstract getKeyboardMap();
  getKeyboardFunction() { return null; }
  
  init(membus:Bus, iobus:Bus, psg) {
    this.connectCPUMemoryBus(membus);
    this.connectCPUIOBus(iobus);
    this.handler = newKeyboardHandler(this.inputs, this.getKeyboardMap(), this.getKeyboardFunction());
    this.psg = psg;
    this.audioadapter = psg && new TssChannelAdapter(psg.psg, audioOversample, this.sampleRate);
  }
  
  setKeyInput(key:number, code:number, flags:number) : void {
    this.handler(key,code,flags);
  }
  
  connectVideo(pixels) {
    super.connectVideo(pixels);
    var cru = {
      setVDPInterrupt: (b) => {
        if (b) {
          this.vdpInterrupt();
        } else {
          // TODO: reset interrupt?
        }
      }
    };
    this.vdp = this.newVDP(this.pixels, cru, true);
  }

  newVDP(frameData, cru, flicker) {
    return new TMS9918A(frameData, cru, flicker);
  }
  
  startScanline() {
    this.audio && this.audioadapter && this.audioadapter.generate(this.audio);
  }

  drawScanline() {
    this.vdp.drawScanline(this.scanline);
  }

  loadState(state) {
    super.loadState(state);
    this.vdp.restoreState(state['vdp']);
  }
  saveState() {
    var state = super.saveState();
    state['vdp'] = this.vdp.getState();
    return state;
  }
  reset() {
    super.reset();
    this.vdp.reset();
    this.psg.reset();
  }

  getDebugCategories() {
    return ['CPU','Stack','VDP'];
  }
  getDebugInfo(category, state) {
    switch (category) {
      case 'VDP': return this.vdpStateToLongString(state.vdp);
    }
  }
  vdpStateToLongString(ppu) {
    return this.vdp.getRegsString();
  }
  readVRAMAddress(a : number) : number {
    return this.vdp.ram[a & 0x3fff];
  }
}

