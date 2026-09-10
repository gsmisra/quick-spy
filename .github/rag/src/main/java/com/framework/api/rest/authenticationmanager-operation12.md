---
id: operation12-authentication-manager-invoke
title: Invokes the AuthenticationManager operation12 method to trigger its built-in runtime action.
tags:
  - authentication
  - manager
  - rest
  - api
  - method-call
  - diagnostics
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation12
sourceHash: 3d5ff007cf6364c58da76cd3066b33939ec298a92fd13d2c0fcdb6bf39e19c5f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute the existing `operation12` capability on `AuthenticationManager` instead of adding new helper behavior.
Requires: An initialized `AuthenticationManager` instance in scope.
API: public void operation12()

```java
authenticationManager.operation12();
```
