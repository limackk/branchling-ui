// Mockup-only app shell: sidebar, top bar, theme switch, phone menu.
// The real page renders the same structure from src/web/; this file exists so
// every mockup shares one navigation without copying it.

const ICONS = "../icons.svg";
const NAV = [
  { id: "overview", label: "Overview", icon: "overview", href: "overview.html" },
  { id: "tasks", label: "Tasks", icon: "tasks", href: "tasks.html", count: 38 },
  { id: "plan", label: "Plan", icon: "plan", href: "plan.html" },
  { id: "releases", label: "Releases", icon: "pipeline", href: "releases.html" },
  { id: "decisions", label: "Decisions", icon: "decision", href: "decisions.html", count: 3, role: "attention" },
  { id: "health", label: "Health", icon: "health", href: "health.html", count: 1, role: "danger" },
];

export function icon(name, cls = "icon") {
  return `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#${name}"/></svg>`;
}

function themeButton() {
  return `<button class="btn btn-ghost btn-icon btn-sm" type="button" data-theme-toggle aria-label="Switch colour scheme">${icon("moon")}</button>`;
}

function render() {
  const body = document.body;
  const page = body.dataset.page;
  const crumb = body.dataset.crumb || "";
  const fresh = body.dataset.fresh || "live";
  const main = document.querySelector("main");
  main.id = "main";
  main.tabIndex = -1;
  main.classList.add("page");

  const nav = NAV.map((n) => `
    <a href="${n.href}" ${n.id === page ? 'aria-current="page"' : ""}>
      ${icon(n.icon)}<span>${n.label}</span>
      ${n.count ? `<span class="count badge plain ${n.role ? "role-" + n.role : ""}"><span class="visually-hidden">: </span>${n.count}</span>` : ""}
    </a>`).join("");

  const freshText = { live: "Live", stale: "Updating… shown from 12:04", off: "Live updates off" }[fresh];

  const shell = document.createElement("div");
  shell.className = "app";
  shell.innerHTML = `
    <aside class="sidebar" aria-label="Main">
      <a class="brand" href="index.html">${icon("brand", "icon brand-mark")}<span>branchling</span></a>
      <div class="backlog-switch">
        <span class="t-caption">Backlog</span>
        <strong>harbor</strong>
        <span class="path">~/work/harbor/backlog</span>
      </div>
      <nav class="nav" aria-label="Views">${nav}</nav>
      <div class="sidebar-foot">
        <span>branchling 0.2.0 · schema 1</span>
        <a href="../design-system.html">Design system</a>
      </div>
    </aside>
    <div class="frame">
      <header class="topbar">
        <button class="btn btn-ghost btn-icon btn-sm menu-button" type="button" aria-label="Open navigation" aria-expanded="false" data-menu>${icon("menu")}</button>
        <div class="crumbs"><span class="hide-sm">harbor</span><span class="hide-sm" aria-hidden="true">/</span><strong>${crumb}</strong></div>
        <div class="spacer"></div>
        <div class="search hide-sm" style="width: 16rem">
          ${icon("search")}
          <label class="visually-hidden" for="q">Find a task</label>
          <input id="q" class="input input-search" type="search" placeholder="Find a task by id or title">
          <kbd>/</kbd>
        </div>
        <span class="fresh" data-state="${fresh}" role="status">${freshText}</span>
        ${themeButton()}
      </header>
    </div>`;
  const skip = document.createElement("a");
  skip.className = "skip";
  skip.href = "#main";
  skip.textContent = "Skip to content";
  body.prepend(skip);
  main.replaceWith(shell);
  shell.querySelector(".frame").append(main);

  const toggle = shell.querySelector("[data-theme-toggle]");
  const root = document.documentElement;
  const isDark = () => root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  const paint = () => { toggle.innerHTML = icon(isDark() ? "sun" : "moon"); };
  try { const saved = localStorage.getItem("theme"); if (saved) root.dataset.theme = saved; } catch {}
  paint();
  toggle.addEventListener("click", () => {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch {}
    paint();
  });

  const menu = shell.querySelector("[data-menu]");
  menu.addEventListener("click", () => {
    const open = shell.dataset.nav !== "open";
    shell.dataset.nav = open ? "open" : "";
    menu.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && shell.dataset.nav === "open") { shell.dataset.nav = ""; menu.focus(); } });

  // Replace <i data-icon="x"> placeholders in the page with the sprite.
  for (const el of document.querySelectorAll("i[data-icon]")) el.outerHTML = icon(el.dataset.icon, el.className ? "icon " + el.className : "icon");
}

render();
