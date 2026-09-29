export interface Achievement {
  id: number;
  title: string;
  description: string;
  points: number;
  type?: string;
  dateEarnedHardcore?: string;
}

export interface AchievementProgress {
  gameId: number;
  title: string;
  achievements: Achievement[];
  remainingHardcore: Achievement[];
}

/** Fetch a single snapshot; callers should cache it and respect the API rate limit. */
export async function getAchievementProgress(gameId: number, username: string, apiKey: string): Promise<AchievementProgress> {
  if (!Number.isInteger(gameId) || gameId <= 0 || !username || !apiKey)
    throw new Error('A game ID, username, and RetroAchievements web API key are required');
  const url = new URL('https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php');
  url.searchParams.set('g', String(gameId));
  url.searchParams.set('u', username);
  url.searchParams.set('y', apiKey);
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`RetroAchievements API returned HTTP ${response.status}`);
  const data = await response.json() as {
    ID: number; Title: string;
    Achievements: Record<string, {
      ID: number; Title: string; Description: string; Points: number;
      type?: string; DateEarnedHardcore?: string;
    }>;
  };
  if (data.ID !== gameId || !data.Achievements) throw new Error('Unexpected RetroAchievements API response');
  const achievements = Object.values(data.Achievements).map(item => ({
    id: item.ID, title: item.Title, description: item.Description,
    points: item.Points, type: item.type, dateEarnedHardcore: item.DateEarnedHardcore,
  }));
  return {
    gameId: data.ID,
    title: data.Title,
    achievements,
    remainingHardcore: achievements.filter(item => !item.dateEarnedHardcore),
  };
}
