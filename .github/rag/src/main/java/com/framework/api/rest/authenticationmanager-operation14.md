---
id: authenticationmanager-operation14-call
title: Call `operation14` on `AuthenticationManager` when a test needs this built-in API-side operation trigger.
tags:
  - authentication
  - api
  - manager
  - operation
  - smoke
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation14
sourceHash: 1e3b2b1fad3db4157aedfaa87341af7f66501915a572835ea0a4325049c6287f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code should invoke the existing `AuthenticationManager` capability directly instead of adding a new helper or duplicate wrapper.
Requires: An already instantiated `AuthenticationManager` object in scope.
API: public void operation14()

```java
authenticationManager.operation14();
```
