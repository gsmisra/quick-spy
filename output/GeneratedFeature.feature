Feature: iPhone Product Configuration and Cart Selection

  Background:
    Given the customer has accessed the Apple Store
    And the customer is browsing the iPhone range
    And the customer has selected the iPhone family
    And the customer is ready to configure a product variant

  Scenario: Customer configures a premium iPhone model successfully
    Given the customer selects the iPhone 17 Pro family
    When the customer chooses the iPhone 17 Pro Max model
    And the customer chooses the 6.9-inch display option
    And the customer chooses the Cosmic Orange finish
    And the customer chooses the 2TB storage option
    Then the selected product should be presented as the iPhone 17 Pro Max
    And the product should display the configured price for the selected specification
    And the customer should be able to continue with the purchase selection flow

  Scenario: Customer sees the expected product configuration summary
    Given the customer is configuring an iPhone 17 Pro Max
    When the customer selects a 6.9-inch display
    And the customer selects Cosmic Orange
    And the customer selects 2TB storage
    Then the customer should see the model, finish, display size, and storage clearly summarized
    And the customer should see the price associated with the selected configuration
    And the purchase selection should remain valid for checkout

  Scenario: Customer reviews the final product configuration before adding to cart
    Given the customer has selected the iPhone 17 Pro Max
    And the customer has chosen the Cosmic Orange finish
    And the customer has chosen the 2TB capacity
    When the customer reviews the configuration
    Then the customer should see the final product details before continuing
    And the customer should be able to move to cart-ready selection

  Scenario Outline: Customer can configure supported iPhone combinations
    Given the customer chooses the "<model>" model
    When the customer selects the "<display>" display size
    And the customer selects the "<finish>" finish
    And the customer selects the "<capacity>" storage option
    Then the configuration should be "<result>"

    Examples:
      | model            | display     | finish         | capacity | result      |
      | iPhone 17 Pro    | 6.9-inch   | Cosmic Orange  | 2TB     | selectable |
      | iPhone 17 Pro    | 6.9-inch   | Cosmic Orange  | 1TB     | selectable |
      | iPhone 17 Pro Max| 6.9-inch   | Cosmic Orange  | 2TB     | selectable |
      | iPhone 17 Pro Max| 6.9-inch   | Black Titanium | 1TB     | selectable |
      | iPhone 17 Pro Max| 6.9-inch   | Silver         | 512GB   | selectable |
