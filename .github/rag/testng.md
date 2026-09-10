---
id: testng-suite-config
title: Defines the TestNG suite configuration file to be referenced when executing tests.
tags:
  - testng
  - suite
  - xml
  - java
  - test-runner
  - configuration
automationMode:
  - ui
  - api
language:
  - java
imports: {}
sourcePath: testng.xml
sourceHash: f8b6e0949bc6af931bb31bfd85234482b2e603ad113066cd180b27b055d1d178
sourceHashScheme: sha256-raw-v1
sourceMapped: false
---

Use: Use this file when a test run should be driven by a shared TestNG suite descriptor instead of hardcoding test selection in code.
Requires: A TestNG-compatible runner or build configuration that accepts a suite XML file path.
API: Reference `testng.xml` at the project root as the suite configuration file.

```yaml
suiteXmlFile: testng.xml
```
