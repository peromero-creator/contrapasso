// Device-local preferences. Nothing here reaches the simulation or the referee.
export interface Settings {
  volume: number;
  shake: number;
  quality: number;
  motion: boolean;
  hints: boolean;
}
const DEFAULTS: Settings = { volume: 1, shake: 1, quality: 1.5, motion: true, hints: true };
const KEY = "contrapasso-settings";

function load(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    return {
      volume: typeof stored.volume === "number" ? Math.min(1, Math.max(0, stored.volume)) : DEFAULTS.volume,
      shake: [0, 0.4, 1].includes(stored.shake as number) ? (stored.shake as number) : DEFAULTS.shake,
      quality: [1, 1.5, 2].includes(stored.quality as number) ? stored.quality! : DEFAULTS.quality,
      motion: typeof stored.motion === "boolean" ? stored.motion : DEFAULTS.motion,
      hints: typeof stored.hints === "boolean" ? stored.hints : DEFAULTS.hints,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export class SettingsPanel {
  readonly values = load();
  private root = document.getElementById("settings")!;
  private returnFocus: HTMLElement | null = null;
  private blocked: [HTMLElement, boolean][] = [];
  private closing = 0;

  constructor(private apply: (values: Settings) => void) {
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const volume = $<HTMLInputElement>("setting-volume");
    volume.addEventListener("input", () => this.change({ volume: Number(volume.value) / 100 }));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-shake]"))
      button.addEventListener("click", () => this.change({ shake: Number(button.dataset.shake) }));
    $("setting-motion").addEventListener("click", () => this.change({ motion: !this.values.motion }));
    $("setting-hints").addEventListener("click", () => this.change({ hints: !this.values.hints }));
    for (const closer of this.root.querySelectorAll<HTMLElement>("[data-settings-close]"))
      closer.addEventListener("click", () => this.close());
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-quality]'))
      button.addEventListener('click',()=>this.change({quality:Number(button.dataset.quality)}));
    $('setting-fullscreen').addEventListener('click',async()=>{
      try { if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen(); }
      catch { $('setting-fullscreen').textContent='Unavailable in this browser'; }
    });
    document.addEventListener('fullscreenchange',()=>{$('setting-fullscreen').textContent=document.fullscreenElement?'EXIT FULL SCREEN':'FULL SCREEN';});
    this.paint();
    this.apply(this.values);
  }

  get open() {
    return !this.root.classList.contains("hidden") && !this.root.classList.contains("closing");
  }
  private change(patch: Partial<Settings>) {
    Object.assign(this.values, patch);
    try {
      localStorage.setItem(KEY, JSON.stringify(this.values));
    } catch {
      /* Preferences still apply for this visit. */
    }
    this.paint();
    this.apply(this.values);
  }
  private paint() {
    const v = this.values;
    const volume = document.getElementById("setting-volume") as HTMLInputElement;
    volume.value = String(Math.round(v.volume * 100));
    document.getElementById("setting-volume-value")!.textContent = `${Math.round(v.volume * 100)}%`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-shake]"))
      button.setAttribute("aria-pressed", String(Number(button.dataset.shake) === v.shake));
    for(const button of this.root.querySelectorAll<HTMLButtonElement>('[data-quality]'))
      button.setAttribute('aria-pressed',String(Number(button.dataset.quality)===v.quality));
    for (const [id, on] of [["setting-motion", v.motion], ["setting-hints", v.hints]] as const) {
      const button = document.getElementById(id)!;
      button.setAttribute("aria-checked", String(on));
      button.querySelector("span")!.textContent = on ? "ON" : "OFF";
    }
  }

  show(returnFocus?: HTMLElement | null) {
    if (this.open) return;
    clearTimeout(this.closing);
    this.returnFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // Everything behind the sheet waits; restore exactly what was interactive before.
    this.blocked = [];
    for (const sibling of document.body.children)
      if (sibling !== this.root && sibling instanceof HTMLElement && sibling.tagName !== "SCRIPT") {
        this.blocked.push([sibling, sibling.inert]);
        sibling.inert = true;
      }
    this.root.classList.remove("hidden", "closing");
    document.getElementById("settings-close")!.focus();
  }
  close() {
    if (!this.open) return;
    for (const [el, inert] of this.blocked) el.inert = inert;
    this.blocked = [];
    this.root.classList.add("closing");
    this.closing = window.setTimeout(() => {
      this.root.classList.add("hidden");
      this.root.classList.remove("closing");
    }, 220);
    this.returnFocus?.focus();
    this.returnFocus = null;
  }
}
