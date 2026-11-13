// The camp is the one place between descents: a fixed bar and exactly one visible page.
// Moving between pages is directional, so the player always knows where they came from.
export type CampPage = "modes" | "forge" | "nft" | "market" | "preparation" | "duel-lobby";
type Motion = "forward" | "back" | "down" | "up";

const TABS: CampPage[] = ["modes", "forge", "nft", "market"];
const PAGES: CampPage[] = [...TABS, "preparation", "duel-lobby"];
/** Pages one step deeper than a tab; Back returns to the parent. */
const PARENT: Partial<Record<CampPage, CampPage>> = { preparation: "modes", "duel-lobby": "modes" };
const LEAVE_MS = 240;
const ENTER_MS = 700;

export class Camp {
  page: CampPage = "modes";
  private root = document.getElementById("camp")!;
  private nav = document.getElementById("camp-nav")!;
  private mark = document.getElementById("camp-nav-mark")!;
  private leaving = new Map<HTMLElement, number>();

  constructor() {
    window.addEventListener("resize", () => this.paintNav());
    void document.fonts?.ready.then(() => this.paintNav());
  }

  private el(page: CampPage) {
    return document.getElementById(page)!;
  }
  /** The tab a page belongs to. */
  tab(page: CampPage = this.page): CampPage {
    return PARENT[page] ?? page;
  }
  parent(page: CampPage = this.page): CampPage | null {
    return PARENT[page] ?? null;
  }
  get active() {
    return !this.root.classList.contains("gone") && !this.root.inert;
  }

  private motion(from: CampPage, to: CampPage): Motion {
    if (PARENT[to] === from) return "down";
    if (PARENT[from] === to) return "up";
    return TABS.indexOf(this.tab(to)) >= TABS.indexOf(this.tab(from)) ? "forward" : "back";
  }
  private settle(el: HTMLElement) {
    const timer = this.leaving.get(el);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.leaving.delete(el);
    }
    el.removeAttribute("data-leave");
    el.removeAttribute("data-enter");
  }

  /** Bring the camp back (from the title screen or a finished descent) on a page, without a page slide. */
  enter(page: CampPage = "modes") {
    for (const id of PAGES) {
      const el = this.el(id);
      this.settle(el);
      el.classList.toggle("hidden", id !== page);
      el.inert = id !== page;
    }
    this.page = page;
    this.root.dataset.page = page;
    this.root.classList.remove("gone");
    this.root.inert = false;
    this.el(page).scrollTop = 0;
    this.paintNav();
  }
  /** Hide the whole camp while a descent is played. */
  leave() {
    this.root.classList.add("gone");
    this.root.inert = true;
  }

  show(page: CampPage) {
    const from = this.page;
    const next = this.el(page);
    if (from === page && !next.classList.contains("hidden")) return;
    const motion = this.motion(from, page);
    for (const id of PAGES) {
      if (id === page) continue;
      const el = this.el(id);
      const wasVisible = id === from && !el.classList.contains("hidden");
      this.settle(el);
      el.inert = true;
      if (!wasVisible) {
        el.classList.add("hidden");
        continue;
      }
      el.dataset.leave = motion;
      this.leaving.set(
        el,
        window.setTimeout(() => {
          el.classList.add("hidden");
          this.settle(el);
        }, LEAVE_MS),
      );
    }
    this.settle(next);
    next.classList.remove("hidden");
    next.inert = false;
    next.scrollTop = 0;
    next.dataset.enter = motion;
    // A transform would trap fixed children (the expanded preview), so drop the state once it has played.
    this.leaving.set(next, window.setTimeout(() => this.settle(next), ENTER_MS));
    this.page = page;
    this.root.dataset.page = page;
    this.paintNav();
  }

  /** Slide the marker under the tab of the current page. */
  paintNav() {
    const tab = this.tab();
    let active: HTMLElement | null = null;
    for (const button of this.nav.querySelectorAll<HTMLElement>("[data-camp]")) {
      const current = button.dataset.camp === tab;
      if (current) {
        button.setAttribute("aria-current", "page");
        active = button;
      } else button.removeAttribute("aria-current");
    }
    this.root.style.setProperty("--camp-tab", String(TABS.indexOf(tab)));
    if (!active || !active.offsetWidth) return;
    // The stylesheet decides which pair applies: a vertical rail, or a top bar on narrow screens.
    this.mark.style.setProperty("--x", `${active.offsetLeft}px`);
    this.mark.style.setProperty("--y", `${active.offsetTop}px`);
    this.mark.style.setProperty("--w", `${active.offsetWidth}px`);
    this.mark.style.setProperty("--h", `${active.offsetHeight}px`);
  }
}
