import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { categories as initialCategories } from '@/data/mockData'
import { useBookStore } from '@/stores/book'

const STORAGE_KEY = 'library_categories'

export const useCategoryStore = defineStore('category', () => {
  const loadCategories = () => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch (e) {
        console.error('Failed to parse stored categories:', e)
      }
    }
    return [...initialCategories]
  }

  const categories = ref(loadCategories())
  const loading = ref(false)

  watch(categories, (newCategories) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newCategories))
  }, { deep: true })

  const totalCategories = computed(() => categories.value.length)

  function getCategoryById(id) {
    return categories.value.find(cat => cat.id === id)
  }

  function addCategory(category) {
    const newId = categories.value.length > 0
      ? Math.max(...categories.value.map(c => c.id)) + 1
      : 1
    categories.value.push({ ...category, id: newId, bookCount: 0 })
    return newId
  }

  function updateCategory(id, data) {
    const index = categories.value.findIndex(cat => cat.id === id)
    if (index !== -1) {
      const prevName = categories.value[index].name
      categories.value[index] = { ...categories.value[index], ...data }
      // 分类重命名后同步图书上冗余的分类名称，保证列表与统计回显一致
      if (data.name && data.name !== prevName) {
        useBookStore().updateBooksCategoryName(id, data.name)
      }
      return true
    }
    return false
  }

  function deleteCategory(id) {
    const index = categories.value.findIndex(cat => cat.id === id)
    if (index !== -1) {
      categories.value.splice(index, 1)
      return true
    }
    return false
  }

  return {
    categories,
    loading,
    totalCategories,
    getCategoryById,
    addCategory,
    updateCategory,
    deleteCategory
  }
})
