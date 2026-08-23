import { CategoryGroup, Person, BankConfig, CategoryRule } from '../models';

export const DEFAULT_PERSONS: Person[] = [
  { id: 'p1', name: 'Mac', color: '#00e5ff' },
  { id: 'p2', name: 'Cheese', color: '#8b5cf6' }
];

export const DEFAULT_BANKS: BankConfig[] = [
  { id: 'b1', name: 'Deutsche Bank', defaultOwner: 'Mac' },
  { id: 'b2', name: 'Amazon Visa (Zinia)', defaultOwner: 'Mac' },
  { id: 'b3', name: 'Amex', defaultOwner: 'Mac' },
  { id: 'b4', name: 'Revolut', defaultOwner: 'Cheese' },
  { id: 'b5', name: 'Commerzbank', defaultOwner: 'Cheese' },
  { id: 'b6', name: 'Sparkasse', defaultOwner: 'Mac' },
  { id: 'b7', name: 'DKB', defaultOwner: 'Mac' },
  { id: 'b8', name: 'ING', defaultOwner: 'Mac' },
  { id: 'b9', name: 'N26', defaultOwner: 'Cheese' },
  { id: 'b10', name: 'Bunq', defaultOwner: 'Cheese' }
];

export const DEFAULT_RULES: CategoryRule[] = [
  { id: 'r1', keyword: 'rewe', categoryItem: 'Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r2', keyword: 'edeka', categoryItem: 'Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r3', keyword: 'lidl', categoryItem: 'Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r4', keyword: 'aldi', categoryItem: 'Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r5', keyword: 'enpal', categoryItem: 'Salary', categoryGroup: 'Income', splitType: 'SELF', paidBy: 'Mac' },
  { id: 'r6', keyword: 'bosch', categoryItem: 'Salary', categoryGroup: 'Income', splitType: 'SELF', paidBy: 'Cheese' },
  { id: 'r7', keyword: 'miete', categoryItem: 'Rent and Utilities', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r8', keyword: 'gym', categoryItem: 'Gym', categoryGroup: 'Lifestyle', splitType: 'SELF' }
];

export const DEFAULT_CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'grp-income',
    name: 'Income',
    icon: '💰',
    items: [
      { id: 'inc-1', groupId: 'grp-income', name: 'Salary', plannedDefault: 8117.17 },
      { id: 'inc-2', groupId: 'grp-income', name: 'Other Income', plannedDefault: 75.10 }
    ]
  },
  {
    id: 'grp-savings',
    name: 'Savings',
    icon: '🏦',
    items: [
      { id: 'sav-1', groupId: 'grp-savings', name: 'Emergency Fund', plannedDefault: 0.00 },
      { id: 'sav-2', groupId: 'grp-savings', name: 'Personal Savings', plannedDefault: 4578.08 }
    ]
  },
  {
    id: 'grp-housing',
    name: 'Housing',
    icon: '🏠',
    items: [
      { id: 'hou-1', groupId: 'grp-housing', name: 'Rent and Utilities', plannedDefault: 1598.99 },
      { id: 'hou-2', groupId: 'grp-housing', name: 'Groceries', plannedDefault: 546.67 },
      { id: 'hou-3', groupId: 'grp-housing', name: 'Home EMI [INR]', plannedDefault: 376.10 },
      { id: 'hou-4', groupId: 'grp-housing', name: 'Home Items', plannedDefault: 6.14 }
    ]
  },
  {
    id: 'grp-transport',
    name: 'Car and Transportation',
    icon: '🚗',
    items: [
      { id: 'tra-1', groupId: 'grp-transport', name: 'Charging', plannedDefault: 34.18 },
      { id: 'tra-2', groupId: 'grp-transport', name: 'Parking and Tolls', plannedDefault: 2.59 },
      { id: 'tra-3', groupId: 'grp-transport', name: 'Maintenance', plannedDefault: 18.10 }
    ]
  },
  {
    id: 'grp-food',
    name: 'Food',
    icon: '🍽️',
    items: [
      { id: 'foo-1', groupId: 'grp-food', name: 'Food and Chill', plannedDefault: 111.39 }
    ]
  },
  {
    id: 'grp-lifestyle',
    name: 'Lifestyle',
    icon: '🎉',
    items: [
      { id: 'lif-1', groupId: 'grp-lifestyle', name: 'Attire and Personal Care', plannedDefault: 479.07 },
      { id: 'lif-2', groupId: 'grp-lifestyle', name: 'Trips & Travel', plannedDefault: 118.25 },
      { id: 'lif-3', groupId: 'grp-lifestyle', name: 'Trips Abroad', plannedDefault: 0.00 },
      { id: 'lif-4', groupId: 'grp-lifestyle', name: 'Gadgets and Tech Tools', plannedDefault: 12.49 },
      { id: 'lif-5', groupId: 'grp-lifestyle', name: 'Mobile Phone Plans', plannedDefault: 37.39 },
      { id: 'lif-6', groupId: 'grp-lifestyle', name: 'Gym', plannedDefault: 156.28 },
      { id: 'lif-7', groupId: 'grp-lifestyle', name: 'Sports & Health Apps', plannedDefault: 0.00 }
    ]
  },
  {
    id: 'grp-giving',
    name: 'Giving',
    icon: '🎁',
    items: [
      { id: 'giv-1', groupId: 'grp-giving', name: 'Gifts', plannedDefault: 109.30 }
    ]
  },
  {
    id: 'grp-medical',
    name: 'Medical',
    icon: '💊',
    items: [
      { id: 'med-1', groupId: 'grp-medical', name: 'Medical', plannedDefault: 7.25 }
    ]
  }
];
