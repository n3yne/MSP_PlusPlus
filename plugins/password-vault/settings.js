// Password Vault plugin — Settings window panel
//
// The vault's own settings (re-prompt timer, Windows Hello, clipboard) live
// inside the encrypted vault and are changed from the Vault tab, so nobody can
// loosen them without the vault open, and making them less strict needs the
// master password. This panel only explains where they are.
(function () {
  const settingsAPI = window.pluginSettingsAPI;
  if (!settingsAPI) return;

  settingsAPI.addPanel("password-vault", "Password Vault", function (panel) {
    panel.innerHTML =
      '<div class="settings-section">' +
      '  <h3 class="settings-section-title">Password Vault</h3>' +
      '  <p class="settings-description settings-description-field">' +
      "    Open the <strong>🔑 Vault</strong> tab in the side panel to set up the vault or use it. Its settings are behind " +
      "    the <strong>⚙</strong> button in that tab, once the vault is unlocked: how often it asks for the master password " +
      "    again, Windows Hello, locking when Windows locks, how long a copied password stays on the clipboard, " +
      "    changing the master password and saving an encrypted copy." +
      "  </p>" +
      '  <p class="settings-description settings-description-field">' +
      "    They're kept inside the encrypted vault, so they can't be changed while it's locked, and making the vault " +
      "    less strict needs the master password." +
      "  </p>" +
      '  <p class="settings-description">' +
      "    <strong>Ctrl+Shift+L</strong> locks the vault from anywhere. The vault is never included in " +
      "    <strong>Move Settings to Another PC</strong>. There is no way to recover it if you forget the master password." +
      "  </p>" +
      "</div>";
  });
})();
