---
id: authentication-manager-operation11-call
title: Invoke `operation11` on `AuthenticationManager` to trigger its built-in operation hook.
tags:
  - authentication
  - manager
  - api
  - operation
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation11
sourceHash: 81bdfa2bfbb0117432b7da8b80c1365c3df37db5d1ff2a0bff679c0fb19e336f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to execute `AuthenticationManager`’s `operation11` behavior directly instead of adding a custom helper.
Requires: An initialized `AuthenticationManager` instance in scope.
API: public void operation11()

```java
authenticationManager.operation11();
```
