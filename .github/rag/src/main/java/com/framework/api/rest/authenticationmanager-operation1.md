---
id: authentication-manager-operation1-call
title: Invoke `AuthenticationManager.operation1` as a no-argument authentication manager action.
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
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation1
sourceHash: dfa4b3f877c473cdc57f69f4187e0977ee5a0b0c79d2e34de6d40f55bdbe15c4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to trigger the `AuthenticationManager` capability named `operation1` directly instead of adding a new helper.
Requires: An available `AuthenticationManager` instance in scope.
API: public void operation1()

```java
authenticationManager.operation1();
```
