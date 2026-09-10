---
id: restclient-initialize
title: Initialize a RestClient instance before running API interactions.
tags:
  - rest
  - client
  - initialize
  - api
  - setup
automationMode:
  - api
language:
  - java
imports:
  java:
    - com.framework.api.rest.RestClient
sourcePath: src/main/java/com/framework/api/rest/RestClient.java#initialize
sourceHash: a375004299f8d037e01380129073bf28732e3d4b7971b420746f861434c27cf0
sourceHashScheme: sha256-with-same-file-deps-v1
sourceMapped: false
---

Use: Call this when test flow needs the RestClient initialization step to run on an existing `RestClient` instance.
Requires: A constructed `RestClient` object. No arguments are required.
API: public void initialize()

```java
restClient.initialize();
```
