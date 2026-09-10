---
id: operation5-authentication-manager-call
title: Invoke AuthenticationManager operation5 from API-oriented test code.
tags:
  - authentication
  - manager
  - api
  - java
  - method-call
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation5
sourceHash: 0883d2cbfd0beeb6e160f4d4ec8f44435c13889d42c4e2fc3eabadf01141aaaf
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test should call the existing `operation5` method on `AuthenticationManager` rather than implementing a new call path.
Requires: An `AuthenticationManager` instance is already available in scope.
API: public void operation5()

```java
authenticationManager.operation5();
```
