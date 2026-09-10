<!-- REJECTED by SoftPlay's "Generate RAG Corpus format" — NOT a valid recipe, NOT indexed by RAG.
     Reason: Source-grounding check failed: The example's actual call to "operation8(" uses a receiver that matches neither the real owner class "AuthenticationManager" nor its usual instance-variable rendering — this looks like a fabricated or different receiver, not a genuine usage. -->

---
id: authentication-manager-operation8-call
title: Call `operation8` on `AuthenticationManager` to execute this predefined authentication-manager operation.
tags: [authentication, manager, api, method-call, java, internal-library]
automationMode: [api]
language: [java]
imports:
  java: [com.framework.api.rest.AuthenticationManager]
---

Use: Use this when a test needs to invoke the existing `AuthenticationManager` capability named `operation8` rather than adding new helper code.
Requires: An initialized `AuthenticationManager` instance in scope.
API: public void operation8()

```java
authManager.operation8();
```
