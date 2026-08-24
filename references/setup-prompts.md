# Copy/paste setup prompts

These prompts are the recommended human-facing entry points. Natural language remains the public API; the agent should execute the referenced github-delivery workflow rather than asking the user to run internal scripts.

## Set up github-delivery

```text
Set up github-delivery from https://github.com/Wibias/github-delivery.
Guide me through the installation interactively. Check my environment and explain the available Windows Hello protection modes, then ask which one I want before enabling protection. Install or upgrade everything required, configure github-delivery, verify the installation, and show me the final effective configuration. Do not perform unrelated GitHub mutations as part of setup.
```

## View or change settings

```text
Show me my current github-delivery settings and let me change them. Show the stored and effective Windows Hello protection mode, explain the available modes, apply only the changes I choose, and verify the resulting configuration.
```

Direct natural language is also valid. Off disables ordinary high-assurance Hello protection, not independently authenticated lifecycle intent or exact-text human-reply approval. For example:

```text
Set github-delivery's Windows Hello protection mode to Off.
```

```text
Only require Windows Hello for sensitive github-delivery actions.
```

```text
Require Windows Hello for every github-delivery write.
```

## Update github-delivery

```text
Update my github-delivery installation to the newest stable release from https://github.com/Wibias/github-delivery.

Preserve all of my local configuration and user-created state. Do not overwrite or reset my settings, and do not silently overwrite locally modified or locally created files inside the installed skill.

After updating, compare my existing configuration with the configuration supported by the new version. If new options, defaults, migrations, or recommended settings were introduced, tell me about them and ask before changing anything. Verify the updated installation and final effective configuration when finished.
```

The update workflow means **latest stable GitHub Release**. It never means the current `main` branch.
