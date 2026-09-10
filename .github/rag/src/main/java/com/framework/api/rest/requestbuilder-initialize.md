---
id: requestbuilder-initialize
title: Triggers the initialization step for a RequestBuilder instance.
tags:
  - requestbuilder
  - initialize
  - api
  - rest
  - setup
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RequestBuilder
sourcePath: src/main/java/com/framework/api/rest/RequestBuilder.java#initialize
sourceHash: 964391e963b0a0fa11e0e07e830cc3bdac6608416037a41e9204f40c1214259f
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when a test needs to explicitly run the RequestBuilder initialization step before making related API requests.
Requires: An existing `RequestBuilder` instance.
API: public void initialize()

```java
requestBuilder.initialize();
```
