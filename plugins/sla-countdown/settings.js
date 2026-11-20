// SLA Countdown plugin — Settings window panel
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  function toggle(id, label) {
    // settings-toggle-spaced: stacked toggles otherwise touch.
    return '  <label class="settings-toggle settings-toggle-spaced">' +
      '    <input type="checkbox" id="' + id + '" />' +
      '    <span class="settings-toggle-slider"></span>' +
      '    <span class="settings-toggle-label">' + label + "</span>" +
      "  </label>";
  }

  function minutesLabel(m) {
    if (m < 60) return m + " minutes";
    return m === 60 ? "1 hour" : (m / 60) + " hours";
  }

  function select(id, label, values, suffix) {
    return '  <div class="settings-field">' +
      '    <label class="settings-field-label" for="' + id + '">' + label + "</label>" +
      '    <div class="settings-field-row">' +
      '      <select id="' + id + '" class="settings-select-input">' +
      values.map(function (v) { return '<option value="' + v + '">' + minutesLabel(v) + (suffix || "") + "</option>"; }).join("") +
      "      </select>" +
      "    </div>" +
      "  </div>";
  }

  const AMBER = [15, 30, 60, 120, 240, 480];
  const RED = [5, 10, 15, 30, 60];
  const REFRESH = [1, 2, 5, 10, 15, 30];

  settingsAPI.addPanel("sla-countdown", "SLA Countdown", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">SLA Countdown</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Shows how long is left before each ticket's <strong>first response</strong> and <strong>resolution</strong> are due: " +
      "    on the tab of every open ticket, and in the <strong>⏱ SLA</strong> tab in the side panel, which also lists your open " +
      "    tickets with the soonest deadline first. The countdown turns amber and then red as a deadline gets close. " +
      "    On Freshservice the due times come from the API, so set up the domain and API key under <strong>Freshservice</strong> first " +
      "    (Freshservice plugin 0.8.5 or later). Tickets in Pending, or a status named On Hold, Awaiting… or Waiting…, show <strong>Hold</strong> " +
      "    because those normally stop the SLA clock." +
      "  </p>" +
      toggle("plugin-sla-badges", "Show the countdown on ticket tabs") +
      toggle("plugin-sla-notify", "Notify me when a ticket turns red or goes past due") +
      '  <p class="settings-description">Notifications show under the bell. With this on, your ticket list is read in the ' +
      "    background too; with it off, only when the SLA tab is showing.</p>" +
      select("plugin-sla-amber", "Turn amber when less than", AMBER, " left") +
      select("plugin-sla-red", "Turn red when less than", RED, " left") +
      select("plugin-sla-refresh", "Read the due times again every", REFRESH) +
      "</div>";

    const el = {
      badges: panel.querySelector("#plugin-sla-badges"),
      notify: panel.querySelector("#plugin-sla-notify"),
      amber: panel.querySelector("#plugin-sla-amber"),
      red: panel.querySelector("#plugin-sla-red"),
      refresh: panel.querySelector("#plugin-sla-refresh"),
    };

    function setSelect(sel, value, fallback) {
      const v = String(Number.isInteger(value) ? value : fallback);
      if (!Array.prototype.some.call(sel.options, function (o) { return o.value === v; })) {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = minutesLabel(Number(v));
        sel.appendChild(o);
      }
      sel.value = v;
    }

    function populate(s) {
      el.badges.checked = s.slaTabBadges !== false;
      el.notify.checked = s.slaNotify !== false;
      setSelect(el.amber, s.slaAmberMinutes, 60);
      setSelect(el.red, s.slaRedMinutes, 15);
      setSelect(el.refresh, s.slaRefreshMinutes, 5);
    }
    populate(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(populate);

    el.badges.addEventListener("change", function () { settingsAPI.saveSettings({ slaTabBadges: el.badges.checked }); });
    el.notify.addEventListener("change", function () { settingsAPI.saveSettings({ slaNotify: el.notify.checked }); });
    el.amber.addEventListener("change", function () {
      const amber = Number(el.amber.value);
      const patch = { slaAmberMinutes: amber };
      // Red can't come before amber.
      if (Number(el.red.value) > amber) patch.slaRedMinutes = RED.filter(function (r) { return r <= amber; }).pop() || 5;
      settingsAPI.saveSettings(patch);
    });
    el.red.addEventListener("change", function () {
      const red = Number(el.red.value);
      const patch = { slaRedMinutes: red };
      if (Number(el.amber.value) < red) patch.slaAmberMinutes = red;
      settingsAPI.saveSettings(patch);
    });
    el.refresh.addEventListener("change", function () { settingsAPI.saveSettings({ slaRefreshMinutes: Number(el.refresh.value) }); });
  });
})();
