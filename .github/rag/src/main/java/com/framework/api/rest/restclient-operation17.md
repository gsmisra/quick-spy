---
id: operation17-rest-client-invoke
title: Invoke the `operation17` method on `RestClient` when a test needs this predefined no-argument API action.
tags:
  - restclient
  - api
  - method-call
  - java
  - void
  - internal-library
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#operation17
sourceHash: 0c6030c4f9b2827674bf0bc3c17f018f587e57814b87c3499978e6ca349a3ab4
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Use this when test code should trigger the existing `RestClient` capability directly instead of creating a new helper.
Requires: An initialized `RestClient` instance is available to call this instance method.
API: public void operation17()

```java
new RestClient().operation17();
```
