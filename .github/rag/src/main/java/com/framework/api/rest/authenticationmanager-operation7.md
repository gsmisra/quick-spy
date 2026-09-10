---
id: operation7-authentication-manager-entrypoint
title: Invoke AuthenticationManager operation7 as a direct no-argument API entrypoint.
tags:
  - authentication
  - manager
  - api
  - method-call
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation7
sourceHash: d7ad833a6938eec90a1382253f0f4d3e762c068546689d302655b25792814a76
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to explicitly execute `operation7` on an existing `AuthenticationManager` instance.
Requires: An initialized `AuthenticationManager` object in scope.
API: public void operation7()

```java
authenticationManager.operation7();
```
