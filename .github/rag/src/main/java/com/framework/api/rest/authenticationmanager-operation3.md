---
id: authentication-manager-operation3-call
title: Invoke `operation3` on `AuthenticationManager` in API-oriented test flows.
tags:
  - authentication
  - api
  - rest
  - manager
  - operation3
  - java
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation3
sourceHash: 99fdb68a52ec6c6ed27e92480186e29ff6bea75a221fa795a49a17608d98c2f9
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to execute the existing `AuthenticationManager` `operation3` capability directly instead of creating a new helper path.
Requires: An available `AuthenticationManager` instance in the current test context.
API: public void operation3()

```java
authenticationManager.operation3();
```
