export interface TweetsResponse {
  status: string;
  code: number;
  msg: string;
  data: Data;
  has_next_page: boolean;
  next_cursor: string;
}

export interface Data {
  pin_tweet: null;
  tweets: Tweet[];
}

export interface Tweet {
  type: RetweetedTweetType;
  id: string;
  url: string;
  twitterUrl: string;
  text: string;
  source: Source;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount: number;
  createdAt: string;
  lang: Lang;
  bookmarkCount: number;
  isReply: boolean;
  inReplyToId: null | string;
  conversationId: string;
  inReplyToUserId: null | string;
  inReplyToUsername: UserNameEnum | null;
  author: TweetAuthor;
  extendedEntities: TweetExtendedEntities;
  card: null;
  place: Place;
  entities: DescriptionClass;
  quoted_tweet: RetweetedTweet | null;
  retweeted_tweet: RetweetedTweet | null;
  article: null;
}

export interface TweetAuthor {
  type: AuthorType;
  userName: UserNameEnum;
  url: string;
  twitterUrl: string;
  id: string;
  name: NameEnum;
  isVerified: boolean;
  isBlueVerified: boolean;
  verifiedType: null;
  profilePicture: string;
  coverPicture: string;
  description: string;
  location: Location;
  followers: number;
  following: number;
  status: string;
  canDm: boolean;
  canMediaTag: boolean;
  createdAt: Date;
  entities: AuthorEntities;
  fastFollowersCount: number;
  favouritesCount: number;
  hasCustomTimelines: boolean;
  isTranslator: boolean;
  mediaCount: number;
  statusesCount: number;
  withheldInCountries: any[];
  affiliatesHighlightedLabel: Place;
  possiblySensitive: boolean;
  pinnedTweetIds: any[];
  profile_bio: ProfileBio;
  isAutomated: boolean;
  automatedBy: null;
}

export interface Place {}

export interface AuthorEntities {
  description: Description;
  url: Place;
}

export interface Description {
  urls: URL[];
}

export interface URL {
  display_url: DisplayURL;
  expanded_url: string;
  indices: number[];
  url: string;
}

export enum DisplayURL {
  BehanceNetAdeyemitoheeb2 = "behance.net/adeyemitoheeb2",
  GithubCOMDaezy = "github.com/daezy",
  ReadswithraviBeehiivCOMSubscribe = "readswithravi.beehiiv.com/subscribe",
}

export enum Location {
  Remote = "Remote",
}

export enum NameEnum {
  Hokage = "Hokage (♟️,\ud83c\udfad)",
}

export interface ProfileBio {
  description: string;
  entities: ProfileBioEntities;
}

export interface ProfileBioEntities {
  description: DescriptionClass;
  url?: Description;
}

export interface DescriptionClass {
  user_mentions?: UserMention[];
}

export interface UserMention {
  id_str: string;
  indices: number[];
  name: string;
  screen_name: string;
}

export enum AuthorType {
  User = "user",
}

export enum UserNameEnum {
  AvaxDevelopers = "AvaxDevelopers",
  DanielEzet = "DanielEzet",
  SyntaxVoyager = "syntax_voyager",
}

export interface TweetExtendedEntities {
  media?: PurpleMedia[];
}

export interface PurpleMedia {
  display_url: string;
  expanded_url: string;
  ext_media_availability: EXTMediaAvailability;
  features: Features;
  id_str: string;
  indices: number[];
  media_key: string;
  media_results: MediaResults;
  media_url_https: string;
  original_info: OriginalInfo;
  sizes: Sizes;
  source_status_id_str?: string;
  source_user_id_str?: string;
  type: string;
  url: string;
  allow_download_status?: AllowDownloadStatus;
}

export interface AllowDownloadStatus {
  allow_download: boolean;
}

export interface EXTMediaAvailability {
  status: string;
}

export interface Features {
  large: OrigClass;
  orig: OrigClass;
}

export interface OrigClass {
  faces?: FocusRect[];
}

export interface FocusRect {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface MediaResults {
  id: string;
  result: Result;
}

export interface Result {
  __typename: string;
  id: string;
  media_key: string;
}

export interface OriginalInfo {
  focus_rects: FocusRect[];
  height: number;
  width: number;
}

export interface Sizes {
  large: SizesLarge;
}

export interface SizesLarge {
  h: number;
  w: number;
}

export enum Lang {
  En = "en",
}

export interface RetweetedTweet {
  type: RetweetedTweetType;
  id: string;
  url: string;
  twitterUrl: string;
  text: string;
  source: Source;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  viewCount: number;
  createdAt: string;
  lang: Lang;
  bookmarkCount: number;
  isReply: boolean;
  inReplyToId: null;
  conversationId: string;
  inReplyToUserId: null;
  inReplyToUsername: null;
  author: RetweetedTweetAuthor;
  extendedEntities: RetweetedTweetExtendedEntities;
  card: null;
  place: Place;
  entities: DescriptionClass;
  quoted_tweet: null;
  retweeted_tweet: null;
  article: null;
}

export interface RetweetedTweetAuthor {
  type: AuthorType;
  userName: string;
  url: string;
  twitterUrl: string;
  id: string;
  name: string;
  isVerified: boolean;
  isBlueVerified: boolean;
  verifiedType: null;
  profilePicture: string;
  coverPicture: string;
  description: string;
  location: string;
  followers: number;
  following: number;
  status: string;
  canDm: boolean;
  canMediaTag: boolean;
  createdAt: string;
  entities: AuthorEntities;
  fastFollowersCount: number;
  favouritesCount: number;
  hasCustomTimelines: boolean;
  isTranslator: boolean;
  mediaCount: number;
  statusesCount: number;
  withheldInCountries: any[];
  affiliatesHighlightedLabel: Place;
  possiblySensitive: boolean;
  pinnedTweetIds: string[];
  profile_bio: ProfileBio;
  isAutomated: boolean;
  automatedBy: null;
}

export interface RetweetedTweetExtendedEntities {
  media?: FluffyMedia[];
}

export interface FluffyMedia {
  allow_download_status?: AllowDownloadStatus;
  display_url: string;
  expanded_url: string;
  ext_media_availability: EXTMediaAvailability;
  features: Features;
  id_str: string;
  indices: number[];
  media_key: string;
  media_results: MediaResults;
  media_url_https: string;
  original_info: OriginalInfo;
  sizes: Sizes;
  type: string;
  url: string;
}

export enum Source {
  TwitterForIPhone = "Twitter for iPhone",
}

export enum RetweetedTweetType {
  Tweet = "tweet",
}

export interface AdvancedData {
  tweets: Tweet[];
  has_next_page: boolean;
  next_cursor: string;
}
