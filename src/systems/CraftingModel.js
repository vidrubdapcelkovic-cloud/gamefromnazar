class CraftingModel {
  constructor(inventoryModel) {
    this.inventoryModel = inventoryModel;
  }

  canCraft(recipeId, station = null) {
    const recipe = RecipeCatalog[recipeId];
    if (!recipe) throw new Error(`Неизвестный рецепт: ${recipeId}.`);
    if (recipe.station && recipe.station !== station) {
      return { recipeId, canCraft: false, reason: 'stationRequired' };
    }
    const exchange = this.inventoryModel.canCraftExchange(recipe.ingredients, recipe.result);
    return {
      recipeId,
      canCraft: exchange.success,
      reason: exchange.success ? null : exchange.reason
    };
  }

  craft(recipeId, station = null) {
    const recipe = RecipeCatalog[recipeId];
    if (!recipe) throw new Error(`Неизвестный рецепт: ${recipeId}.`);
    if (recipe.station && recipe.station !== station) {
      return { success: false, reason: 'stationRequired' };
    }
    const exchange = this.inventoryModel.craftExchange(recipe.ingredients, recipe.result);
    if (!exchange.success) return exchange;
    return {
      success: true,
      recipeId,
      resultItemType: recipe.result.itemType,
      resultQuantity: recipe.result.quantity
    };
  }
}
