---
id: authentication-manager-operation6-invoke
title: Invoke `operation6` on `AuthenticationManager` to run its built-in operation hook.
tags:
  - authentication
  - manager
  - api
  - method-call
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation6
sourceHash: 5042228268a9e7a2947cb0326f47d6fd5576a89035e822223a5921499e3b6875
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the `AuthenticationManager` `operation6` behavior directly instead of adding custom helper code.
Requires: An instantiated `AuthenticationManager` object.
API: public void operation6()

```java
new AuthenticationManager().operation6();
```
