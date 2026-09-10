---
id: authentication-manager-operation9
title: Invoke AuthenticationManager.operation9 as a no-argument API-side action on an existing manager instance.
tags:
  - authentication
  - api
  - rest
  - manager
  - no-arg
  - invocation
  - coverage
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.AuthenticationManager
sourcePath: src/main/java/com/framework/api/rest/AuthenticationManager.java#operation9
sourceHash: a76a6f9fe4b80195146032d738b97edab18c1a3358b542ed82022943f9c1cd04
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when a test needs to directly invoke the exposed `operation9` capability on `AuthenticationManager` instead of adding a new helper wrapper.
Requires: A constructed `AuthenticationManager` instance available in scope before the call.
API: public void operation9()

```java
authenticationManager.operation9();
```
