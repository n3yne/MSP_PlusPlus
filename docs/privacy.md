# MSP++ privacy policy

[Docs home](README.md) › Privacy policy

*Last updated: November 25, 2026. Applies to MSP++ 0.8.9 and later, including the Microsoft Store version.*

MSP++ is a free, open-source desktop app published by Esscey (GitHub: [n3yne](https://github.com/n3yne)). This page explains what information MSP++ handles and where it goes.

**The short version:** MSP++ has no servers of its own and no accounts. It doesn't collect analytics, telemetry, crash reports or advertising data, and the publisher never receives your information. Everything MSP++ stores stays on your PC. It only sends information to the websites and services that you choose to use in it.

## Information stored on your PC

MSP++ keeps its data in your user profile on your PC (see [Files and folders](data-files.md) for every file). This includes:

- **Your settings and plugin settings**, such as the sites you use, bookmarks, canned responses and tab colours.
- **Browsing data** for the sites you open in MSP++, such as cookies and sign-ins, the same as a web browser keeps.
- **Plugin data** that you create, such as note backups, time entries, reminders and recent tickets. These can contain ticket details from your ticketing system.
- **API keys and sign-ins** that you enter for Freshservice or AI services. These are encrypted with Windows' own protection (DPAPI) or the macOS keychain.
- **Password Vault** entries, if you use that plugin. The vault is encrypted with your master password and, on Windows, can be unlocked with Windows Hello. Your Windows Hello biometrics never reach MSP++.

You can delete this data at any time by deleting the data folder or uninstalling MSP++. Uninstalling the Microsoft Store version also deletes the files it created.

## Information sent to other services

MSP++ only connects to:

- **Websites you open** in its tabs, such as your Freshservice or ConnectWise Manage site. They receive what any browser would send them. Their own privacy policies apply.
- **Your ticketing system's API** (Freshservice, ConnectWise Manage), using the API key you provide, to show tickets and counts and to make changes you ask for.
- **AI services you set up**, if you use an AI plugin: Hatz AI, OpenAI, Anthropic, Azure OpenAI, Microsoft 365 Copilot or the Copilot website. When you ask for a summary, a suggested note or a chat answer, the text you send and the ticket details needed for it go to that service under your own account. Nothing goes to an AI service until you set one up and use it. Their own privacy policies apply.
- **Microsoft sign-in pages**, on Windows with **Use Windows Device Sign-On** on. MSP++ asks Windows for a short-lived proof that the PC is registered with your organisation and sends it only to Microsoft's sign-in pages, the same way Microsoft Edge does. You can turn this off in Settings → General.
- **GitHub**, to download plugins from the MSP++ plugin directory and, outside the Microsoft Store version, to check for app updates. GitHub sees a normal download request (such as your IP address). MSP++ sends no personal information with it.

MSP++ doesn't sell, rent or share your information with anyone else, and doesn't use it for advertising.

## Plugins

Features in MSP++ come from plugins in the MSP++ plugin directory, published by the same developer and covered by this policy. If you install a plugin from somewhere else, that plugin's author is responsible for what it does.

## Children

MSP++ is a work tool for IT staff and isn't directed at children.

## Your choices

- Don't set up AI services, or remove their keys, to keep ticket data from going to them.
- Remove a plugin and tick **Also delete its saved data** to delete its data, or delete the data folder to remove everything.
- Turn off Use Windows Device Sign-On in Settings → General.

Because the publisher doesn't receive or hold your information, there is nothing held by the publisher to access, correct or delete. Your data is on your PC and under your control.

## Changes

If this policy changes, the new version will be posted on this page with a new date. The full history is in the repository.

## Contact

Questions about this policy: open an issue at <https://github.com/n3yne/MSP_PlusPlus/issues>.
