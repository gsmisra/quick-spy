---
id: operation16-authentication-manager-call
title: Invoke AuthenticationManager.operation16 to trigger its built-in operation call action.
tags:
  - authentication
  - api
  - manager
  - operation16
  - invocation
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation16
sourceHash: 9edae0788102a34d463fe15fe35d6db3e17989b0a8f3e94433f50007c2f36a67
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test should execute the existing `operation16` entrypoint on `AuthenticationManager` rather than adding a new helper.
Requires: An initialized `AuthenticationManager` instance in scope.
API: public void operation16()

```java
authenticationManager.operation16();
```
