---
id: operation13-authentication-manager-call
title: Invoke AuthenticationManager operation13 as an existing no-argument class action.
tags:
  - authentication
  - manager
  - operation13
  - api
  - java
  - hook
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation13
sourceHash: 78c0c55ae49d4cf05168947f2d6cf595a876c22a83622377bce9a946a4f6f8a7
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test should trigger the built-in `AuthenticationManager` capability named `operation13` instead of adding a new wrapper method.
Requires: An initialized `AuthenticationManager` instance must already be available in scope; this call takes no arguments and returns no value.
API: public void operation13()

```java
authenticationManager.operation13();
```
