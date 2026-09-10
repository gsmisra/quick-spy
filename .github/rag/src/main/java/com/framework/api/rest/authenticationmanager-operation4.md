---
id: authentication-manager-operation4-call
title: Calls the `operation4` method on `AuthenticationManager`.
tags:
  - authentication
  - manager
  - api
  - method-call
  - logging
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation4
sourceHash: 59d6ee6915d8b7c1ecb166607a654b65847e50d6a54ec57daf18e372a04e064f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to invoke the existing `AuthenticationManager` operation directly instead of adding a new helper.
Requires: An initialized `AuthenticationManager` instance in scope.
API: public void operation4()

```java
authenticationManager.operation4();
```
