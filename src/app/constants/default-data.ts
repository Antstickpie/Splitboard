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
  { id: 'b5', name: 'Commerzbank', defaultOwner: 'Cheese' }
];

export const DEFAULT_RULES: CategoryRule[] = [
  { id: 'r1', keyword: 'rewe', categoryItem: '[N][C-Mac] Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r2', keyword: 'edeka', categoryItem: '[N][C-Mac] Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r3', keyword: 'lidl', categoryItem: '[N][C-Mac] Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r4', keyword: 'aldi', categoryItem: '[N][C-Mac] Groceries', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r5', keyword: 'enpal', categoryItem: 'Mac Enpal Salary', categoryGroup: 'Income', splitType: 'SELF', paidBy: 'Mac' },
  { id: 'r6', keyword: 'bosch', categoryItem: 'Cheese Bosch Salary', categoryGroup: 'Income', splitType: 'SELF', paidBy: 'Cheese' },
  { id: 'r7', keyword: 'miete', categoryItem: '[N][C-Mac] Rent and utilities', categoryGroup: 'Housing', splitType: 'SPLIT', splitPercentage: 50 },
  { id: 'r8', keyword: 'gym', categoryItem: '[W][C-Mac] - Gym', categoryGroup: 'Lifestyle', splitType: 'SELF' }
];

export const DEFAULT_CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'grp-income',
    name: 'Income',
    icon: '💰',
    items: [
      { id: 'inc-1', groupId: 'grp-income', name: 'Mac Enpal Salary', defaultOwner: 'Mac', plannedDefault: 4317.17 },
      { id: 'inc-2', groupId: 'grp-income', name: 'Cheese Bosch Salary', defaultOwner: 'Cheese', plannedDefault: 3800.00 },
      { id: 'inc-3', groupId: 'grp-income', name: 'Mom gave Cheese', defaultOwner: 'Cheese', plannedDefault: 75.10 }
    ]
  },
  {
    id: 'grp-savings',
    name: 'Savings',
    icon: '🏦',
    items: [
      { id: 'sav-1', groupId: 'grp-savings', name: 'Emergency Fund', plannedDefault: 0.00 },
      { id: 'sav-2', groupId: 'grp-savings', name: "Cheese's savings", defaultOwner: 'Cheese', plannedDefault: 1988.13 },
      { id: 'sav-3', groupId: 'grp-savings', name: "Mac's savings", defaultOwner: 'Mac', plannedDefault: 2589.95 }
    ]
  },
  {
    id: 'grp-housing',
    name: 'Housing',
    icon: '🏠',
    items: [
      { id: 'hou-1', groupId: 'grp-housing', name: '[N][C-Cheese] Rent and utilities', defaultOwner: 'Cheese', plannedDefault: 799.50 },
      { id: 'hou-2', groupId: 'grp-housing', name: '[N][C-Mac] Rent and utilities', defaultOwner: 'Mac', plannedDefault: 799.49 },
      { id: 'hou-3', groupId: 'grp-housing', name: '[N][C-Cheese] Groceries', defaultOwner: 'Cheese', plannedDefault: 276.15 },
      { id: 'hou-4', groupId: 'grp-housing', name: '[N][C-Mac] Groceries', defaultOwner: 'Mac', plannedDefault: 270.52 },
      { id: 'hou-5', groupId: 'grp-housing', name: '[S] Mac - Home EMI [INR]', defaultOwner: 'Mac', plannedDefault: 376.10 },
      { id: 'hou-6', groupId: 'grp-housing', name: '[Needs][C-Cheese] Home items', defaultOwner: 'Cheese', plannedDefault: 3.08 },
      { id: 'hou-7', groupId: 'grp-housing', name: '[Needs][C-Mac] Home items', defaultOwner: 'Mac', plannedDefault: 3.06 }
    ]
  },
  {
    id: 'grp-transport',
    name: 'Car and Transportation',
    icon: '🚗',
    items: [
      { id: 'tra-1', groupId: 'grp-transport', name: '[N][C-Cheese] Charge', defaultOwner: 'Cheese', plannedDefault: 17.09 },
      { id: 'tra-2', groupId: 'grp-transport', name: '[N][C-Mac] Charge', defaultOwner: 'Mac', plannedDefault: 17.09 },
      { id: 'tra-3', groupId: 'grp-transport', name: '[N][C-Cheese] Parking and tolls', defaultOwner: 'Cheese', plannedDefault: 1.15 },
      { id: 'tra-4', groupId: 'grp-transport', name: '[N][C-Mac] Parking and tolls', defaultOwner: 'Mac', plannedDefault: 1.44 },
      { id: 'tra-5', groupId: 'grp-transport', name: '[N][C-Cheese] Maintenance', defaultOwner: 'Cheese', plannedDefault: 9.05 },
      { id: 'tra-6', groupId: 'grp-transport', name: '[N][C-Mac] Maintenance', defaultOwner: 'Mac', plannedDefault: 9.05 }
    ]
  },
  {
    id: 'grp-food',
    name: 'Food',
    icon: '🍽️',
    items: [
      { id: 'foo-1', groupId: 'grp-food', name: '[W][C-Cheese]Food and Chill', defaultOwner: 'Cheese', plannedDefault: 61.04 },
      { id: 'foo-2', groupId: 'grp-food', name: '[W][C-Mac]Food and Chill', defaultOwner: 'Mac', plannedDefault: 50.35 }
    ]
  },
  {
    id: 'grp-lifestyle',
    name: 'Lifestyle',
    icon: '🎉',
    items: [
      { id: 'lif-1', groupId: 'grp-lifestyle', name: '[N]Mac -Sports and Health/ Apps', defaultOwner: 'Mac', plannedDefault: 0.00 },
      { id: 'lif-2', groupId: 'grp-lifestyle', name: '[W] Mac - Attire and Personal care', defaultOwner: 'Mac', plannedDefault: 0.00 },
      { id: 'lif-3', groupId: 'grp-lifestyle', name: '[W]Cheese - Attire, Personal care and food', defaultOwner: 'Cheese', plannedDefault: 479.07 },
      { id: 'lif-4', groupId: 'grp-lifestyle', name: '[W][C-Cheese]Trips', defaultOwner: 'Cheese', plannedDefault: 37.51 },
      { id: 'lif-5', groupId: 'grp-lifestyle', name: '[W][C-Mac]Trips', defaultOwner: 'Mac', plannedDefault: 80.74 },
      { id: 'lif-6', groupId: 'grp-lifestyle', name: '[W][C-Cheese] Trips abroad', defaultOwner: 'Cheese', plannedDefault: 0.00 },
      { id: 'lif-7', groupId: 'grp-lifestyle', name: '[W][C-Mac] Trips abroad', defaultOwner: 'Mac', plannedDefault: 0.00 },
      { id: 'lif-8', groupId: 'grp-lifestyle', name: '[W] Cheese - Gadgets and General tools/tech', defaultOwner: 'Cheese', plannedDefault: 2.40 },
      { id: 'lif-9', groupId: 'grp-lifestyle', name: '[W] Mac - Gadgets and General tools/tech', defaultOwner: 'Mac', plannedDefault: 10.09 },
      { id: 'lif-10', groupId: 'grp-lifestyle', name: '[W] Mobile Cheese', defaultOwner: 'Cheese', plannedDefault: 11.11 },
      { id: 'lif-11', groupId: 'grp-lifestyle', name: '[W] Mobile Mac', defaultOwner: 'Mac', plannedDefault: 26.28 },
      { id: 'lif-12', groupId: 'grp-lifestyle', name: '[W][C-Cheese] - Gym', defaultOwner: 'Cheese', plannedDefault: 96.28 },
      { id: 'lif-13', groupId: 'grp-lifestyle', name: '[W][C-Mac] - Gym', defaultOwner: 'Mac', plannedDefault: 60.00 }
    ]
  },
  {
    id: 'grp-giving',
    name: 'Giving',
    icon: '🎁',
    items: [
      { id: 'giv-1', groupId: 'grp-giving', name: '[W][C-Cheese] Gifts', defaultOwner: 'Cheese', plannedDefault: 89.91 },
      { id: 'giv-2', groupId: 'grp-giving', name: '[W][C-Mac] Gifts', defaultOwner: 'Mac', plannedDefault: 19.39 }
    ]
  },
  {
    id: 'grp-medical',
    name: 'Medical',
    icon: '💊',
    items: [
      { id: 'med-1', groupId: 'grp-medical', name: '[N][C-Mac] Medical', defaultOwner: 'Mac', plannedDefault: 3.62 },
      { id: 'med-2', groupId: 'grp-medical', name: '[N][C-Cheese] Medical', defaultOwner: 'Cheese', plannedDefault: 3.63 }
    ]
  }
];
