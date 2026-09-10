# BDD Java Test Automation Framework Guide

This document provides a comprehensive blueprint and ready-to-use utility templates for a scalable **BDD Java Automation Framework** built using **Cucumber JVM**. It includes common components for DB connections, Kafka messaging, WebDriver reuse, and API testing.

---

## 🏗️ 1. Project Architecture

The recommended directory structure separates framework core utilities from test artifacts (feature files, page objects, and step definitions).

```text
my-bdd-framework/
├── src/
│   ├── main/java/com/framework/
│   │   ├── config/          # Environment & property readers
│   │   └── utils/           # The Core Utilities
│   │       ├── db/          # Database helper (HikariCP)
│   │       ├── kafka/       # Kafka producer/consumer wrappers
│   │       ├── ui/          # WebDriver factory & explicit wait helpers
│   │       └── api/         # RestAssured specifications
│   └── test/java/com/tester/
│       ├── runners/         # Cucumber TestNG/JUnit runners
│       ├── stepdefs/        # BDD Step definitions (calls utils & pages)
│       └── pages/           # Web UI Page Objects
└── src/test/resources/
    ├── features/            # .feature files written in Gherkin
    └── config.properties    # DB credentials, Kafka bootstrap servers, URLs
```

---

## 📦 2. Mandatory Maven Dependencies (`pom.xml`)

Add these core dependencies to your project to integrate Cucumber, Selenium, RestAssured, Kafka, and Database connection pooling.

```xml
<dependencies>
    <!-- Cucumber BDD -->
    <dependency>
        <groupId>io.cucumber</groupId>
        <artifactId>cucumber-java</artifactId>
        <version>7.15.0</version>
    </dependency>
    <dependency>
        <groupId>io.cucumber</groupId>
        <artifactId>cucumber-junit-platform-engine</artifactId>
        <version>7.15.0</version>
        <scope>test</scope>
    </dependency>

    <!-- UI Automation (Selenium & Driver Manager) -->
    <dependency>
        <groupId>org.seleniumhq.selenium</groupId>
        <artifactId>selenium-java</artifactId>
        <version>4.18.1</version>
    </dependency>
    <dependency>
        <groupId>io.github.bonigarcia</groupId>
        <artifactId>webdrivermanager</artifactId>
        <version>5.6.3</version>
    </dependency>

    <!-- API Testing -->
    <dependency>
        <groupId>io.rest-assured</groupId>
        <artifactId>rest-assured</artifactId>
        <version>5.4.0</version>
    </dependency>

    <!-- Database Connection Pooling -->
    <dependency>
        <groupId>com.zaxxer</groupId>
        <artifactId>HikariCP</artifactId>
        <version>5.1.0</version>
    </dependency>
    <dependency>
        <groupId>org.postgresql</groupId>
        <artifactId>postgresql</artifactId>
        <version>42.7.2</version>
    </dependency>

    <!-- Apache Kafka Client -->
    <dependency>
        <groupId>org.apache.kafka</groupId>
        <artifactId>kafka-clients</artifactId>
        <version>3.6.1</version>
    </dependency>
</dependencies>
```

---

## 🛠️ 3. Reusable Utility Implementations

### 📊 Database Utility (`DBUtils.java`)
Manages robust connection pooling using HikariCP and returns query results as a flexible list of maps.

```java
package com.framework.utils.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.*;
import java.util.*;

public class DBUtils {
    private static HikariDataSource dataSource;

    static {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://localhost:5432/mydb");
        config.setUsername("db_user");
        config.setPassword("db_password");
        config.setMaximumPoolSize(10);
        dataSource = new HikariDataSource(config);
    }

    public static List<Map<String, Object>> executeQuery(String query) {
        List<Map<String, Object>> rows = new ArrayList<>();
        try (Connection conn = dataSource.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(query)) {
            
            ResultSetMetaData metaData = rs.getMetaData();
            int columnCount = metaData.getColumnCount();

            while (rs.next()) {
                Map<String, Object> row = new HashMap<>();
                for (int i = 1; i <= columnCount; i++) {
                    row.put(metaData.getColumnName(i), rs.getObject(i));
                }
                rows.add(row);
            }
        } catch (SQLException e) {
            e.printStackTrace();
            throw new RuntimeException("Database query execution failed.");
        }
        return rows;
    }
}
```

---

### 🖧 Kafka Utility (`KafkaUtils.java`)
Handles event-driven messaging tasks, including producing test payloads and consuming events concurrently for background assertions.

```java
package com.framework.utils.kafka;

import org.apache.kafka.clients.consumer.*;
import org.apache.kafka.clients.producer.*;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import java.time.Duration;
import java.util.*;

public class KafkaUtils {
    private static final String BOOTSTRAP_SERVERS = "localhost:9092";

    public static void publishMessage(String topic, String key, String value) {
        Properties props = new Properties();
        props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());
        props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class.getName());

        try (Producer<String, String> producer = new KafkaProducer<>(props)) {
            producer.send(new ProducerRecord<>(topic, key, value));
        }
    }

    public static List<String> consumeMessages(String topic, int timeoutSeconds) {
        Properties props = new Properties();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, BOOTSTRAP_SERVERS);
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "bdd-test-group-" + UUID.randomUUID());
        props.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
        props.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

        List<String> messages = new ArrayList<>();
        try (Consumer<String, String> consumer = new KafkaConsumer<>(props)) {
            consumer.subscribe(Collections.singletonList(topic));
            long endTime = System.currentTimeMillis() + (timeoutSeconds * 1000L);
            
            while (System.currentTimeMillis() < endTime) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(500));
                for (ConsumerRecord<String, String> record : records) {
                    messages.add(record.value());
                }
                if (!messages.isEmpty()) break; 
            }
        }
        return messages;
    }
}
```

---

### 🌐 WebDriver Wrapper (`DriverHelper.java`)
Encapsulates explicit waits, page interactions, and safe UI operational mechanics.

```java
package com.framework.utils.ui;

import org.openqa.selenium.*;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public class DriverHelper {
    private WebDriver driver;
    private WebDriverWait wait;

    public DriverHelper(WebDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
    }

    public void clickElement(By locator) {
        wait.until(ExpectedConditions.elementToBeClickable(locator)).click();
    }

    public void enterText(By locator, String text) {
        WebElement element = wait.until(ExpectedConditions.visibilityOfElementLocated(locator));
        element.clear();
        element.sendKeys(text);
    }

    public String getElementText(By locator) {
        return wait.until(ExpectedConditions.visibilityOfElementLocated(locator)).getText();
    }
}
```

---

### 🔌 API Client Wrapper (`RestApiClient.java`)
Wraps RestAssured configurations to manage reusable request specifications, standard global headers, and baseline endpoints.

```java
package com.framework.utils.api;

import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;

public class RestApiClient {
    private static final String BASE_URL = "https://api.example.com";
    
    private static RequestSpecification getRequestSpec() {
        return new RequestSpecBuilder()
                .setBaseUri(BASE_URL)
                .setContentType(ContentType.JSON)
                .addHeader("Authorization", "Bearer mock-token")
                .build();
    }

    public static Response get(String endpoint) {
        return RestAssured.given().spec(getRequestSpec()).get(endpoint);
    }

    public static Response post(String endpoint, Object body) {
        return RestAssured.given().spec(getRequestSpec()).body(body).post(endpoint);
    }
}
```

---

## 🏃 4. End-to-End BDD Workflow Example

### 🌟 Feature File (`order_processing.feature`)
```gherkin
Feature: End-to-End Order Lifecycle Processing

  Scenario: Verify API order placement propagates to Database and Kafka
    Given the tester registers an order via the API endpoint
    When the customer searches for the order text in the application dashboard
    Then an active event notification should be generated in the "orders-topic" Kafka stream
    And the database record status should explicitly reflect "PROCESSED"
```

### 📋 Cucumber Step Definition Integration (`OrderStepDefs.java`)
```java
package com.tester.stepdefs;

import com.framework.utils.api.RestApiClient;
import com.framework.utils.db.DBUtils;
import com.framework.utils.kafka.KafkaUtils;
import com.framework.utils.ui.DriverHelper;
import io.cucumber.java.en.*;
import io.restassured.response.Response;
import org.junit.jupiter.api.Assertions;
import org.openqa.selenium.By;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import java.util.*;

public class OrderStepDefs {
    private WebDriver driver = new ChromeDriver(); // Should ideally be managed via a DriverFactory Hook
    private DriverHelper ui = new DriverHelper(driver);
    private String orderId = "ORD-99215";

    @Given("the tester registers an order via the API endpoint")
    public void registerOrderViaApi() {
        String payload = "{"orderId":"" + orderId + "", "amount":150.00}";
        Response response = RestApiClient.post("/v1/orders", payload);
        Assertions.assertEquals(201, response.getStatusCode());
    }

    @When("the customer searches for the order text in the application dashboard")
    public void searchForOrderInDashboard() {
        driver.get("https://app.example.com/dashboard");
        ui.enterText(By.id("search-box"), orderId);
        ui.clickElement(By.id("search-btn"));
    }

    @Then("an active event notification should be generated in the {string} Kafka stream")
    public void verifyKafkaNotification(String topic) {
        List<String> messages = KafkaUtils.consumeMessages(topic, 5);
        boolean messageFound = messages.stream().anyMatch(msg -> msg.contains(orderId));
        Assertions.assertTrue(messageFound, "Expected order event was not found in Kafka topic!");
    }

    @And("the database record status should explicitly reflect {string}")
    public void verifyDatabaseRecordStatus(String expectedStatus) {
        String query = "SELECT status FROM orders WHERE id = '" + orderId + "'";
        List<Map<String, Object>> results = DBUtils.executeQuery(query);
        
        Assertions.assertFalse(results.isEmpty(), "No database record found for order ID: " + orderId);
        String actualStatus = results.get(0).get("status").toString();
        Assertions.assertEquals(expectedStatus, actualStatus);
        
        driver.quit(); // Clean up session
    }
}
```
