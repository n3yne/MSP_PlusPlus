(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("connectwise-manage", "ConnectWise Manage", function (panel) {

    const section = document.createElement("div");
    section.className = "settings-section";
    section.innerHTML =
      '<h3 class="settings-section-title">Custom URL</h3>' +

      '<div class="settings-field settings-field-column">' +
      '  <label class="settings-field-label" for="cw-plugin-custom-url">Custom URL</label>' +
      '  <input type="text" id="cw-plugin-custom-url" class="settings-text-input"' +
      '    placeholder="https://connectwise.yourcompany.com" maxlength="2048" spellcheck="false" autocomplete="off" />' +
      "</div>" +

      '<p class="settings-description settings-description-field">' +
      "If your ConnectWise Manage runs on your own server or domain instead of myconnectwise.net, " +
      "enter its address here. Pages on that host are then treated as ConnectWise Manage. " +
      "Only the host name is kept. Reload any ConnectWise tabs that are already open. " +
      "With MSP++ 0.8.3 or newer the host also gets the Chrome user agent and sign-in popup windows. " +
      "Leave it empty if you use a myconnectwise.net address." +
      "</p>";
    panel.appendChild(section);

    const elUrl = panel.querySelector("#cw-plugin-custom-url");

    // Mirrors normalizeCustomHost in renderer.js and validCustomHost in main.js.
    const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
    const OTHER_SITE_HOST = /(?:^|\.)(?:freshservice|freshworks|myfreshworks)\.com$/;
    function normalizeCustomHost(raw) {
      let value = String(raw || "").trim();
      if (!value) return "";
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = "https://" + value;
      let url;
      try { url = new URL(value); } catch { return null; }
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
      const host = url.hostname.toLowerCase().replace(/\.$/, "");
      return HOST.test(host) ? host : null;
    }

    function applyForm(s) {
      if (document.activeElement !== elUrl) elUrl.value = s.cwCustomHost || "";
    }
    applyForm(settingsAPI.getSettings());
    settingsAPI.onSettingsChanged(applyForm);

    elUrl.addEventListener("change", async function () {
      const host = normalizeCustomHost(elUrl.value);
      let error = "";
      if (host === null) error = "Enter your ConnectWise Manage address, e.g. https://connectwise.yourcompany.com";
      else if (OTHER_SITE_HOST.test(host)) error = "That is a Freshservice address, not a ConnectWise Manage one.";
      if (error) {
        elUrl.setCustomValidity(error);
        elUrl.reportValidity();
        return;
      }
      elUrl.setCustomValidity("");
      elUrl.value = host;
      const result = await settingsAPI.saveSettings({ cwCustomHost: host });
      if (result && result.success === false) {
        elUrl.setCustomValidity(result.error || "The address could not be saved.");
        elUrl.reportValidity();
      }
    });
    elUrl.addEventListener("input", function () { elUrl.setCustomValidity(""); });
  });
})();
