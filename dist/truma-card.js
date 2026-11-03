/*
 * Truma Card – Lovelace-Karte für Home Assistant
 * Zeigt und steuert eine Truma Combi Heizung (climate-Entität)
 * und deren Boiler (select-Entität mit Aus / Eco / Hot).
 */

const CARD_VERSION = "1.0.0";

const DEFAULTS = {
  name: "Truma Combi",
  show_diagram: true,
  default_temperature: 20,
  max_delta: 10,
};

// Zeit, nach der ein nicht bestätigtes Kommando verworfen wird
const PENDING_TIMEOUT = 15000;
// Wartezeit nach dem letzten +/- Tipp, bevor die Soll-Temperatur gesendet wird
const SEND_DELAY = 800;

const LABELS = {
  de: {
    heating: "Heizung",
    room: "Wohnraum",
    room_temp: "Raumtemperatur",
    target: "Soll",
    heater: "Truma Combi",
    boiler: "Boiler",
    energy_mix: "Energie",
    error: "Fehler",
    heats_to: "heizt auf",
    reached: "Soll erreicht",
    off: "Aus",
    on: "Ein",
    no_error: "kein Fehler",
    unavailable: "nicht verfügbar",
    mode_off: "kein Warmwasser",
    mode_eco: "Wasser 40 °C",
    mode_hot: "Wasser 60 °C",
    mode_on: "aktiv",
    fuel: "Brennstoff",
    electricity: "Strom",
    mix: "Mix",
  },
  en: {
    heating: "Heating",
    room: "Living area",
    room_temp: "Room temperature",
    target: "Target",
    heater: "Truma Combi",
    boiler: "Boiler",
    energy_mix: "Energy",
    error: "Error",
    heats_to: "heating to",
    reached: "target reached",
    off: "Off",
    on: "On",
    no_error: "no error",
    unavailable: "unavailable",
    mode_off: "no hot water",
    mode_eco: "water 40 °C",
    mode_hot: "water 60 °C",
    mode_on: "active",
    fuel: "Fuel",
    electricity: "Electric",
    mix: "Mix",
  },
};

const BOILER_ICONS = {
  off: "mdi:water-off-outline",
  eco: "mdi:water-thermometer-outline",
  hot: "mdi:fire",
  on: "mdi:water-boiler",
};

const MIX_ICONS = {
  fuel: "mdi:fuel",
  electricity: "mdi:flash",
  mix: "mdi:lightning-bolt-circle",
};

// Flache Darstellung: Wohnraum ← Warmluft ← Truma Combi → Warmwasser → Boiler
const DIAGRAM = `
  <svg class="diagram" viewBox="0 0 400 184" role="img" aria-hidden="true">
    <!-- Leitungen (liegen hinter den Geräten) -->
    <g class="wire air">
      <path class="base" d="M118 82 H92"/>
      <path class="dash" d="M118 82 H92"/>
      <path class="base" d="M118 118 H92"/>
      <path class="dash" d="M118 118 H92"/>
    </g>
    <g class="wire water">
      <path class="base" d="M298 104 H322"/>
      <path class="dash" d="M298 104 H322"/>
    </g>

    <!-- Wohnraum -->
    <g class="room" data-key="climate">
      <path class="house" d="M20 92 L56 60 L92 92 V146 H20 Z"/>
      <text x="56" y="126" class="room-text">—</text>
      <text x="56" y="40" class="caption">{room}</text>
    </g>

    <!-- Truma Combi -->
    <g class="heater" data-key="climate">
      <path class="foot" d="M138 150 L146 136 H162 L168 150 Z"/>
      <path class="foot" d="M222 150 L228 136 H244 L250 150 Z"/>
      <rect class="outlet" x="114" y="70" width="20" height="24" rx="4"/>
      <rect class="outlet" x="114" y="106" width="20" height="24" rx="4"/>
      <ellipse class="outlet-end" cx="115" cy="82" rx="3" ry="11"/>
      <ellipse class="outlet-end" cx="115" cy="118" rx="3" ry="11"/>
      <rect class="drum" x="128" y="50" width="124" height="98" rx="16"/>
      <path class="ribs" d="M136 60 H246 M134 68 H248 M134 76 H248 M134 84 H248 M134 92 H248 M134 100 H248
        M134 108 H248 M134 116 H248 M134 124 H248 M134 132 H248 M136 140 H246"/>
      <text x="188" y="94" class="brand">Truma</text>
      <text x="188" y="114" class="sub-brand">Combi</text>
      <path class="flame" d="M188 120 C181 128 182 136 188 140 C194 136 195 128 188 120 Z
        M188 130 C186 133 186 136 188 138 C190 136 190 133 188 130 Z"/>
      <rect class="flange" x="246" y="44" width="20" height="110" rx="8"/>
      <rect class="stub" x="252" y="100" width="16" height="7" rx="2"/>
      <rect class="ebox" x="262" y="62" width="36" height="84" rx="7"/>
      <path class="grille" d="M270 108 V138 M276 108 V138 M282 108 V138 M288 108 V138"/>
      <rect class="vent" x="268" y="70" width="24" height="18" rx="3"/>
      <circle class="led" cx="280" cy="97" r="3.5"/>
      <text x="206" y="26" class="caption device">{heater}</text>
    </g>

    <!-- Boiler / Warmwasser -->
    <g class="tap" data-key="boiler">
      <rect class="box" x="322" y="62" width="56" height="84" rx="8"/>
      <path class="drop" d="M350 74 C342 86 338 92 338 98 A12 12 0 0 0 362 98 C362 92 358 86 350 74 Z"/>
      <text x="350" y="134" class="mode-text">—</text>
      <text x="350" y="40" class="caption">{boiler}</text>
    </g>
  </svg>`;

class TrumaCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
    this._pending = {};
    this._target = null;
  }

  static getConfigElement() {
    return document.createElement("truma-card-editor");
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {});
    const find = (domain, ...words) =>
      ids.find((id) => id.startsWith(`${domain}.`) && words.every((w) => id.includes(w))) || "";
    // Thermostat mit Raumtemperatur bevorzugen
    const climates = ids.filter((id) => id.startsWith("climate.") && id.includes("truma"));
    const climate =
      climates.find((id) => hass.states[id].attributes.current_temperature != null) || climates[0] || "";
    return {
      name: DEFAULTS.name,
      climate,
      boiler: find("select", "truma", "boiler") || find("select", "truma", "water"),
      energy_mix: find("select", "truma", "energy_mix"),
      error: find("sensor", "truma", "error"),
    };
  }

  setConfig(config) {
    if (!config) throw new Error("Ungültige Konfiguration");
    this._config = { ...DEFAULTS, ...config };
    this._build();
    if (this._hass) this._update();
  }

  set hass(hass) {
    const langChanged = this._lang && this._lang !== this._langOf(hass);
    this._hass = hass;
    if (!this._config) return;
    if (langChanged || !this._lang) this._build();
    this._update();
  }

  getCardSize() {
    return this._config?.show_diagram === false ? 4 : 7;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  disconnectedCallback() {
    clearTimeout(this._sendTimer);
  }

  // ---------------------------------------------------------------- helpers

  _langOf(hass) {
    return (hass?.locale?.language || hass?.language || "de").slice(0, 2);
  }

  _t(key) {
    return (LABELS[this._langOf(this._hass)] || LABELS.en)[key] ?? LABELS.en[key] ?? key;
  }

  _stateObj(key) {
    const entityId = this._config[key];
    if (!entityId) return null;
    const stateObj = this._hass?.states?.[entityId];
    if (!stateObj || ["unavailable", "unknown"].includes(stateObj.state)) return { entityId, missing: true };
    return { entityId, stateObj };
  }

  _format(value, precision = 0) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const locale = this._hass?.locale?.language || this._hass?.language || "de";
    return value.toLocaleString(locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  }

  _tempUnit() {
    return this._hass?.config?.unit_system?.temperature || "°C";
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    this.dispatchEvent(ev);
  }

  _call(domain, service, data, entityId) {
    return this._hass
      .callService(domain, service, data, { entity_id: entityId })
      .catch((err) => console.error("truma-card:", err));
  }

  // Kommando merken, bis der Zustand der Entität dazu passt
  _setPending(key, value) {
    clearTimeout(this._pending[key]?.timer);
    const timer = setTimeout(() => {
      delete this._pending[key];
      this._update();
    }, PENDING_TIMEOUT);
    this._pending[key] = { value, timer };
  }

  _clearPending(key) {
    clearTimeout(this._pending[key]?.timer);
    delete this._pending[key];
  }

  // Zuletzt genutzte Soll-Temperatur, damit "Ein" dort weitermacht
  _storageKey() {
    return `truma-card:${this._config.climate}:target`;
  }

  _rememberTarget(value) {
    this._lastTarget = value;
    try {
      localStorage.setItem(this._storageKey(), String(value));
    } catch (e) {
      /* privates Fenster o. ä. */
    }
  }

  _savedTarget() {
    if (this._lastTarget != null) return this._lastTarget;
    try {
      const v = parseFloat(localStorage.getItem(this._storageKey()));
      if (Number.isFinite(v) && v > 0) return (this._lastTarget = v);
    } catch (e) {
      /* privates Fenster o. ä. */
    }
    return Number(this._config.default_temperature) || DEFAULTS.default_temperature;
  }

  _climateInfo() {
    const data = this._stateObj("climate");
    if (!data) return null;
    if (data.missing) return { ...data, available: false };
    const a = data.stateObj.attributes;
    const on = data.stateObj.state !== "off";
    const target = Number(a.temperature);
    if (on && Number.isFinite(target) && target > 0 && this._lastTarget !== target) this._rememberTarget(target);
    const current = a.current_temperature == null ? null : Number(a.current_temperature);
    return {
      ...data,
      available: true,
      on,
      heating: on && a.hvac_action !== "idle" && a.hvac_action !== "off",
      current: Number.isFinite(current) ? current : null,
      target: on && Number.isFinite(target) && target > 0 ? target : this._savedTarget(),
      min: Number(a.min_temp ?? 5),
      max: Number(a.max_temp ?? 30),
      step: Number(a.target_temp_step ?? 1) || 1,
    };
  }

  _boilerMode(option, options = []) {
    const o = String(option ?? "").toLowerCase();
    if (!o) return null;
    if (["aus", "off", "0", "none"].includes(o) || o === String(options[0] ?? "").toLowerCase()) return "off";
    if (o.includes("eco")) return "eco";
    if (o.includes("hot") || o.includes("heiß") || o.includes("boost")) return "hot";
    return "on";
  }

  // ---------------------------------------------------------------- actions

  _togglePower() {
    const info = this._climateInfo();
    if (!info?.available || this._pending.power) return;
    clearTimeout(this._sendTimer);
    this._target = null;
    if (info.on) {
      this._setPending("power", false);
      this._call("climate", "set_hvac_mode", { hvac_mode: "off" }, info.entityId);
    } else {
      // Einschalten über die Soll-Temperatur: das MQTT-Target-Topic erwartet eine Zahl
      this._setPending("power", true);
      this._call("climate", "set_temperature", { temperature: info.target }, info.entityId);
    }
    this._update();
  }

  _changeTemp(delta) {
    const info = this._climateInfo();
    if (!info?.available) return;
    const base = this._target ?? info.target;
    const value = Math.min(Math.max(base + delta * info.step, info.min), info.max);
    this._target = value;
    if (!info.on) {
      // Bei ausgeschalteter Heizung nur vormerken
      this._rememberTarget(value);
      this._target = null;
      this._update();
      return;
    }
    clearTimeout(this._sendTimer);
    this._sendTimer = setTimeout(() => {
      this._sendTimer = null;
      this._setPending("temp", value);
      this._call("climate", "set_temperature", { temperature: value }, info.entityId);
    }, SEND_DELAY);
    this._update();
  }

  _selectBoiler(option) {
    const data = this._stateObj("boiler");
    if (!data || data.missing || data.stateObj.state === option || this._pending.boiler) return;
    this._setPending("boiler", option);
    this._call("select", "select_option", { option }, data.entityId);
    this._update();
  }

  // ---------------------------------------------------------------- render

  _build() {
    const c = this._config;
    this._lang = this._langOf(this._hass);
    const val = (key, label, primary = false) => `
      <div class="val ${primary ? "primary" : ""}" data-key="${key}" tabindex="0" role="button">
        <div class="label">${this._t(label)}</div>
        <div class="value"><span class="num">—</span><span class="unit"></span></div>
        <div class="sub"></div>
      </div>`;
    const chip = (key) => `
      <span class="chip" data-key="${key}" tabindex="0" role="button" title="${this._t(key)}">
        <ha-icon></ha-icon><span class="chip-text">—</span>
      </span>`;
    const diagram = DIAGRAM.replace(/\{(\w+)\}/g, (_, k) => escapeHtml(this._t(k)));

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        ${c.name || c.energy_mix || c.error ? `
          <div class="header">
            <span class="title">${escapeHtml(c.name || "")}</span>
            ${chip("energy_mix")}${chip("error")}
          </div>` : ""}
        ${c.show_diagram !== false ? diagram : ""}
        <div class="groups">
          <section class="group heat">
            <div class="group-head"><ha-icon class="heat-icon" icon="mdi:radiator"></ha-icon>${this._t("heating")}</div>
            ${val("climate", "room_temp", true)}
            <div class="ctrl">
              <button class="power" aria-label="${this._t("on")} / ${this._t("off")}">
                <ha-icon icon="mdi:power"></ha-icon><span class="power-text">—</span>
              </button>
              <div class="stepper">
                <button class="round minus" aria-label="−"><ha-icon icon="mdi:minus"></ha-icon></button>
                <div class="set">
                  <div class="set-value"><span class="num">—</span><span class="unit"></span></div>
                  <div class="label">${this._t("target")}</div>
                </div>
                <button class="round plus" aria-label="+"><ha-icon icon="mdi:plus"></ha-icon></button>
              </div>
            </div>
          </section>
          <section class="group water">
            <div class="group-head"><ha-icon class="water-icon" icon="mdi:water-boiler"></ha-icon>${this._t("boiler")}</div>
            <div class="val primary" data-key="boiler" tabindex="0" role="button">
              <div class="value"><span class="num">—</span></div>
              <div class="sub"></div>
            </div>
            <div class="modes"></div>
          </section>
        </div>
      </ha-card>`;

    const root = this.shadowRoot;
    root.querySelectorAll("[data-key]").forEach((el) => {
      const open = () => this._moreInfo(this._config[el.dataset.key]);
      el.addEventListener("click", open);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") open();
      });
    });
    root.querySelector(".power").addEventListener("click", () => this._togglePower());
    root.querySelector(".minus").addEventListener("click", () => this._changeTemp(-1));
    root.querySelector(".plus").addEventListener("click", () => this._changeTemp(1));
    this._modeKey = "";
  }

  _setVal(key, text, { unit = "", sub = "", unavailable = false, hidden = false } = {}) {
    const el = this.shadowRoot.querySelector(`.val[data-key="${key}"]`);
    if (!el) return;
    el.classList.toggle("hidden", hidden);
    if (hidden) return;
    el.classList.toggle("unavailable", unavailable);
    el.querySelector(".num").textContent = unavailable ? "—" : text;
    const unitEl = el.querySelector(".unit");
    if (unitEl) unitEl.textContent = unavailable ? "" : unit;
    el.querySelector(".sub").textContent = unavailable ? this._t("unavailable") : sub;
  }

  _setChip(key, data, text, icon, level = "") {
    const el = this.shadowRoot.querySelector(`.chip[data-key="${key}"]`);
    if (!el) return;
    el.classList.toggle("hidden", !data);
    el.dataset.level = level;
    el.querySelector("ha-icon").setAttribute("icon", icon);
    el.querySelector(".chip-text").textContent = text;
  }

  _update() {
    const root = this.shadowRoot;
    if (!root.querySelector("ha-card")) return;
    const c = this._config;
    const unit = this._tempUnit();

    // ---- Heizung
    const info = this._climateInfo();
    if (this._pending.power && info?.available && info.on === this._pending.power.value) this._clearPending("power");
    if (this._pending.temp && info?.available && info.target === this._pending.temp.value) {
      this._clearPending("temp");
      this._target = null;
    }
    if (!this._pending.temp && !this._sendTimer && this._target === info?.target) this._target = null;

    const heat = root.querySelector(".group.heat");
    heat.classList.toggle("hidden", !info);
    const ok = !!info?.available;
    const on = ok && info.on;
    const target = ok ? this._target ?? info.target : null;
    const tPrec = info?.step < 1 ? 1 : 0;
    let heatSub = "";
    if (ok) {
      if (!on) heatSub = this._t("off");
      else if (info.current !== null && info.current >= target) heatSub = this._t("reached");
      else heatSub = `${this._t("heats_to")} ${this._format(target, tPrec)} ${unit}`;
    }
    this._setVal("climate", this._format(info?.current ?? null, 1), {
      unit: info?.current == null ? "" : unit,
      sub: heatSub,
      unavailable: !ok,
      hidden: !info,
    });
    heat.dataset.state = !ok ? "unavailable" : on ? "on" : "off";
    root.querySelector(".heat-icon").setAttribute("icon", on ? "mdi:radiator" : "mdi:radiator-off");

    const power = root.querySelector(".power");
    power.classList.toggle("active", on);
    power.classList.toggle("busy", !!this._pending.power);
    power.disabled = !ok || !!this._pending.power;
    power.querySelector(".power-text").textContent = ok ? this._t(on ? "on" : "off") : "—";

    root.querySelector(".set .num").textContent = target === null ? "—" : this._format(target, tPrec);
    root.querySelector(".set .unit").textContent = target === null ? "" : unit;
    root.querySelector(".stepper").classList.toggle("busy", !!this._pending.temp || !!this._sendTimer);
    root.querySelector(".minus").disabled = !ok || target <= info.min;
    root.querySelector(".plus").disabled = !ok || target >= info.max;

    // ---- Boiler
    const boiler = this._stateObj("boiler");
    const options = boiler?.stateObj?.attributes?.options || [];
    const option = boiler?.stateObj?.state;
    if (this._pending.boiler && option === this._pending.boiler.value) this._clearPending("boiler");
    const mode = boiler && !boiler.missing ? this._boilerMode(option, options) : null;
    const water = root.querySelector(".group.water");
    water.classList.toggle("hidden", !boiler);
    water.dataset.mode = mode || "unavailable";
    this._setVal("boiler", capitalize(option ?? ""), {
      sub: mode ? this._t(`mode_${mode}`) : "",
      unavailable: !mode,
      hidden: !boiler,
    });
    root.querySelector(".water-icon").setAttribute("icon", BOILER_ICONS[mode] || "mdi:water-boiler-alert");

    const modes = root.querySelector(".modes");
    const modeKey = options.join("|");
    if (modeKey !== this._modeKey) {
      this._modeKey = modeKey;
      modes.innerHTML = options
        .map(
          (o) => `
          <button class="mode-btn" data-mode="${this._boilerMode(o, options)}">
            <ha-icon icon="${BOILER_ICONS[this._boilerMode(o, options)]}"></ha-icon><span>${escapeHtml(capitalize(o))}</span>
          </button>`
        )
        .join("");
      modes.querySelectorAll(".mode-btn").forEach((b, i) =>
        b.addEventListener("click", () => this._selectBoiler(options[i]))
      );
    }
    const busy = this._pending.boiler?.value;
    modes.querySelectorAll(".mode-btn").forEach((b, i) => {
      const active = options[i] === option;
      b.classList.toggle("active", active);
      b.classList.toggle("busy", busy === options[i]);
      b.disabled = !mode || !!busy || active;
    });

    // ---- Status als Chips in der Titelzeile
    const mix = this._stateObj("energy_mix");
    const err = this._stateObj("error");
    const mixState = mix?.stateObj?.state;
    this._setChip("energy_mix", mix, mixState ? capitalize(this._t(mixState)) : "—", MIX_ICONS[mixState] || "mdi:lightning-bolt");
    const errState = err?.stateObj?.state;
    const hasError = !!errState && !["none", "0", "ok", "no_error"].includes(errState.toLowerCase());
    this._setChip(
      "error",
      err,
      !errState ? "—" : hasError ? errState : this._t("no_error"),
      hasError ? "mdi:alert-circle" : "mdi:check-circle-outline",
      hasError ? "critical" : "ok"
    );

    // ---- Grafik
    const svg = root.querySelector(".diagram");
    if (!svg) return;
    svg.querySelector(".room").dataset.state = on ? "on" : "off";
    svg.querySelector(".room-text").textContent =
      info?.current == null ? "—" : `${this._format(info.current, 1)}°`;
    const delta = on && info.current !== null ? Math.max(target - info.current, 0) : 0;
    const ratio = Math.min(delta / (Number(c.max_delta) || DEFAULTS.max_delta), 1);
    const air = svg.querySelector(".wire.air");
    air.classList.toggle("active", on && info.heating);
    air.style.setProperty("--speed", `${(2.6 - ratio * 2).toFixed(2)}s`);

    const heater = svg.querySelector(".heater");
    heater.dataset.state = hasError ? "error" : on && info.heating ? "heating" : on || (mode && mode !== "off") ? "on" : "off";
    heater.classList.toggle("flaming", (on && info.heating) || mode === "hot" || mode === "eco");

    const waterOn = !!mode && mode !== "off";
    svg.querySelector(".tap").dataset.mode = mode || "off";
    svg.querySelector(".mode-text").textContent = mode ? capitalize(option) : "—";
    svg.querySelector(".wire.water").classList.toggle("active", waterOn);
  }
}

// -------------------------------------------------------------------- editor

const EDITOR_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "climate", selector: { entity: { domain: "climate" } } },
  { name: "boiler", selector: { entity: { domain: ["select", "input_select"] } } },
  { name: "energy_mix", selector: { entity: { domain: ["select", "sensor"] } } },
  { name: "error", selector: { entity: { domain: "sensor" } } },
  {
    type: "grid",
    name: "",
    schema: [
      { name: "default_temperature", selector: { number: { min: 5, max: 30, unit_of_measurement: "°C", mode: "box" } } },
      { name: "max_delta", selector: { number: { min: 1, max: 30, unit_of_measurement: "K", mode: "box" } } },
    ],
  },
  { name: "show_diagram", selector: { boolean: {} } },
];

const EDITOR_LABELS = {
  name: "Titel",
  climate: "Heizung (Thermostat)",
  boiler: "Boiler (Auswahl Aus / Eco / Hot)",
  energy_mix: "Energiemix (optional)",
  error: "Fehler (optional)",
  default_temperature: "Soll-Temperatur beim Einschalten",
  max_delta: "Max. Differenz Soll–Ist (Animation)",
  show_diagram: "Grafik anzeigen",
};

class TrumaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => EDITOR_LABELS[s.name] ?? s.name;
      this._form.addEventListener("value-changed", (ev) => {
        const config = { ...ev.detail.value };
        // leere Felder nicht in die YAML schreiben
        Object.keys(config).forEach((k) => {
          if (config[k] === "" || config[k] === undefined) delete config[k];
        });
        this.dispatchEvent(
          new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
        );
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}

// -------------------------------------------------------------------- styles

const STYLES = `
  :host {
    /* per card-mod überschreibbar */
    --truma-heat: #ef6c00;
    --truma-water: #2f8fdd;
    --truma-hot: #e53935;
    --truma-device: #78909c;
    --truma-ok: #43a047;
    --truma-crit: var(--error-color, #db4437);
    --truma-muted: var(--divider-color, rgba(127,127,127,0.3));
  }
  ha-card { display: block; overflow: hidden; padding-bottom: 16px; container-type: inline-size; }
  .hidden { display: none !important; }
  button { font: inherit; color: inherit; }
  .header {
    display: flex; align-items: center; gap: 6px;
    padding: 16px 16px 0; font-size: 1.25em; font-weight: 500;
    color: var(--primary-text-color);
  }
  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chip {
    --c: var(--truma-device);
    flex: none; display: inline-flex; align-items: center; gap: 4px; max-width: 45%;
    padding: 3px 10px 3px 7px; border-radius: 999px; cursor: pointer;
    font-size: 0.6em; font-weight: 600; white-space: nowrap;
    background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c);
  }
  .chip ha-icon { --mdc-icon-size: 16px; flex: none; }
  .chip-text { overflow: hidden; text-overflow: ellipsis; }
  .chip[data-level="ok"] { --c: var(--truma-ok); }
  .chip[data-level="critical"] { --c: var(--truma-crit); }
  .chip:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  /* ---- Grafik ---- */
  .diagram { display: block; width: 100%; max-width: 440px; margin: 8px auto 0; padding: 0 12px; box-sizing: border-box; }
  .diagram [data-key] { cursor: pointer; }
  .caption { font-size: 12px; font-weight: 600; text-anchor: middle; }
  .caption.device { fill: var(--secondary-text-color); font-weight: 500; }

  .room { --c: var(--truma-muted); }
  .room[data-state="on"] { --c: var(--truma-heat); }
  .room .caption { fill: var(--truma-heat); }
  .house {
    fill: color-mix(in srgb, var(--c) 14%, transparent); stroke: var(--c); stroke-width: 2.5;
    stroke-linejoin: round; transition: fill .4s, stroke .4s;
  }
  .room[data-state="off"] .house { stroke: color-mix(in srgb, var(--truma-heat) 45%, var(--truma-muted)); }
  .room-text { fill: var(--primary-text-color); font-size: 15px; font-weight: 700; text-anchor: middle; }

  .foot { fill: #8a9096; }
  .outlet { fill: #2b2f33; stroke: #4a5056; stroke-width: 1; }
  .outlet-end { fill: #111315; }
  .drum { fill: #26292c; stroke: #3d4247; stroke-width: 1.5; }
  .ribs { stroke: rgba(255,255,255,.06); stroke-width: 2; }
  .brand { fill: #c7cbcf; font-size: 20px; font-weight: 700; text-anchor: middle; letter-spacing: .5px; }
  .sub-brand { fill: #9aa0a6; font-size: 12px; font-weight: 600; text-anchor: middle; }
  .flange { fill: #3a3f44; }
  .stub { fill: #e6c619; }
  .ebox { fill: #4a5056; stroke: #5d646b; stroke-width: 1; }
  .grille { stroke: #2d3135; stroke-width: 3; stroke-linecap: round; }
  .vent { fill: #3a3f44; }
  .flame { fill: var(--truma-heat); fill-rule: evenodd; opacity: 0; transform-box: fill-box; transform-origin: 50% 100%; transition: opacity .4s; }
  .heater.flaming .flame { opacity: 1; animation: flicker 1.2s ease-in-out infinite; }
  .led { fill: #2d3135; transition: fill .3s; }
  .heater[data-state="on"] .led { fill: var(--truma-ok); }
  .heater[data-state="heating"] .led { fill: var(--truma-heat); animation: blink 1.6s steps(2) infinite; }
  .heater[data-state="error"] .led { fill: var(--truma-crit); animation: blink 1s steps(2) infinite; }

  .tap { --c: var(--truma-muted); }
  .tap[data-mode="eco"], .tap[data-mode="on"] { --c: var(--truma-water); }
  .tap[data-mode="hot"] { --c: var(--truma-hot); }
  .tap .caption { fill: var(--truma-water); }
  .tap .box { fill: color-mix(in srgb, var(--c) 14%, transparent); stroke: var(--c); stroke-width: 2.5; transition: fill .4s, stroke .4s; }
  .tap[data-mode="off"] .box { stroke: color-mix(in srgb, var(--truma-water) 45%, var(--truma-muted)); }
  .drop { fill: color-mix(in srgb, var(--c) 55%, transparent); stroke: var(--c); stroke-width: 2; transition: fill .4s; }
  .tap[data-mode="off"] .drop { fill: none; stroke: color-mix(in srgb, var(--truma-water) 45%, var(--truma-muted)); }
  .mode-text { fill: var(--primary-text-color); font-size: 12px; font-weight: 700; text-anchor: middle; }

  .wire path { fill: none; stroke-width: 3.5; stroke-linejoin: round; stroke-linecap: round; }
  .wire .base { stroke: var(--truma-muted); }
  .wire.active.air .base { stroke: color-mix(in srgb, var(--truma-heat) 35%, transparent); }
  .wire.active.water .base { stroke: color-mix(in srgb, var(--truma-water) 35%, transparent); }
  .wire .dash { opacity: 0; stroke-dasharray: 3 11; }
  .wire.active .dash { opacity: 1; animation: flow var(--speed, 2s) linear infinite; }
  .wire.air .dash { stroke: var(--truma-heat); }
  .wire.water .dash { stroke: var(--truma-water); --speed: 2.2s; }
  @keyframes flow { to { stroke-dashoffset: -14; } }
  @keyframes blink { 50% { fill: transparent; } }
  @keyframes flicker { 50% { transform: scale(.85, .75); } }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) {
    .wire.active .dash { animation: none; stroke-dasharray: none; }
    .heater.flaming .flame { animation: none; }
  }

  /* ---- Gruppen ---- */
  .groups {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 8px; padding: 12px 16px 0;
  }
  @container (max-width: 520px) {
    .groups { grid-template-columns: 1fr; }
  }
  .group {
    --c: var(--truma-heat);
    display: flex; flex-direction: column; gap: 8px; min-width: 0;
    padding: 10px 12px 12px;
    border-radius: var(--ha-card-border-radius, 12px);
    background: color-mix(in srgb, var(--c) 10%, var(--card-background-color, transparent));
    border-top: 4px solid var(--c);
    transition: background .4s, border-color .4s;
  }
  .group.water { --c: var(--truma-water); }
  .group.water[data-mode="hot"] { --c: var(--truma-hot); }
  .group.heat[data-state="off"] .val.primary .num,
  .group.water[data-mode="off"] .val.primary .num { color: var(--secondary-text-color); }
  .group-head {
    display: flex; align-items: center; gap: 6px;
    font-size: 0.85em; font-weight: 600; color: var(--c);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .group-head ha-icon { --mdc-icon-size: 20px; flex: none; }
  .val { cursor: pointer; min-width: 0; border-radius: 6px; }
  .val:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
  .label { font-size: 0.75em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .value { color: var(--primary-text-color); white-space: nowrap; }
  .num { font-size: 1.15em; font-weight: 600; font-variant-numeric: tabular-nums; }
  .primary .num { font-size: 1.75em; line-height: 1.15; }
  .unit { margin-left: 3px; font-size: 0.85em; color: var(--secondary-text-color); }
  .val.unavailable .num { color: var(--disabled-text-color, #999); }
  .sub { font-size: 0.75em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub:empty { display: none; }

  /* ---- Bedienung ---- */
  .ctrl { display: flex; align-items: center; gap: 10px; margin-top: auto; }
  .power {
    flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    width: 56px; height: 56px; border: none; cursor: pointer; border-radius: 14px;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    color: var(--secondary-text-color); font-size: 0.7em; font-weight: 600;
    transition: background .3s, color .3s;
  }
  .power ha-icon { --mdc-icon-size: 22px; }
  .power.active { background: var(--c); color: #fff; }
  .power:disabled { cursor: default; }
  .busy { animation: pulse 1s ease-in-out infinite; }
  .stepper { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
  .group.heat[data-state="off"] .stepper { opacity: .55; }
  .round {
    flex: none; width: 44px; height: 44px; border-radius: 50%; border: none; cursor: pointer;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    display: flex; align-items: center; justify-content: center; color: var(--c);
  }
  .round ha-icon { --mdc-icon-size: 24px; }
  .round:disabled { opacity: .35; cursor: default; }
  .set { flex: 1; min-width: 56px; text-align: center; }
  .set-value { color: var(--primary-text-color); white-space: nowrap; }
  .set-value .num { font-size: 1.5em; }
  .power:focus-visible, .round:focus-visible, .mode-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }

  .modes { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; margin-top: auto; }
  .mode-btn {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-height: 56px; padding: 4px; border: none; cursor: pointer; min-width: 0;
    border-radius: 12px;
    background: color-mix(in srgb, var(--primary-text-color) 8%, transparent);
    color: var(--secondary-text-color); font-size: 0.8em; font-weight: 600;
    transition: background .3s, color .3s;
  }
  .mode-btn span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mode-btn ha-icon { --mdc-icon-size: 22px; }
  .mode-btn.active { color: #fff; cursor: default; background: var(--truma-device); }
  .mode-btn.active[data-mode="eco"], .mode-btn.active[data-mode="on"] { background: var(--truma-water); }
  .mode-btn.active[data-mode="hot"] { background: var(--truma-hot); }
  .mode-btn:disabled:not(.active) { cursor: default; }
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function capitalize(s) {
  s = String(s ?? "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// -------------------------------------------------------------------- register

if (!customElements.get("truma-card")) {
  customElements.define("truma-card", TrumaCard);
}
if (!customElements.get("truma-card-editor")) {
  customElements.define("truma-card-editor", TrumaCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "truma-card")) {
  window.customCards.push({
    type: "truma-card",
    name: "Truma Card",
    description: "Truma Combi Heizung und Boiler anzeigen und steuern (Raumtemperatur, Soll, Ein/Aus, Aus/Eco/Hot).",
    preview: true,
    documentationURL: "https://github.com/abcklaus/truma-card",
  });
}

console.info(
  `%c TRUMA-CARD %c v${CARD_VERSION} `,
  "color:#fff;background:#ef6c00;font-weight:700;",
  "color:#ef6c00;background:#fff;font-weight:700;"
);
