Feature: Shopping
  Background:
    Given I open the shop

  Scenario: Search catalog
    When I search for "boots"
    Then I see catalog results

  Scenario Outline: Add product to basket
    When I add "<product>" to my basket
    And I set quantity to <quantity>
    Then the basket contains <quantity> items

    Examples:
      | product | quantity |
      | hat     | 1        |
      | coat    | 2        |

  Scenario: Remove product
    When I remove "hat" from my basket
    Then the basket is empty

  Scenario Outline: Apply discount
    When I apply discount "<code>"
    Then the discount is <amount>
    Examples:
      | code | amount |
      | SAVE | 10     |
