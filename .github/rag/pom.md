---
id: maven-pom-project-descriptor
title: Use the root pom.xml file as the Maven project descriptor for build-aware test setup.
tags:
  - maven
  - pom
  - build
  - java
  - project-config
  - dependencies
automationMode:
  - api
language:
  - java
sourcePath: pom.xml
sourceHash: a14bf2af3815357a8477a50d9135c3b3a2971874bf214848b66b8cc62fbb0ab5
sourceHashScheme: sha256-raw-v1
sourceMapped: false
---

Use: Reach for this when tests need project build metadata from the existing Maven descriptor instead of duplicating it.
Requires: A Maven project with `pom.xml` available at the repository root.
API: Reference `pom.xml` directly as the Maven descriptor file.

```bash
mvn -f pom.xml test
```
