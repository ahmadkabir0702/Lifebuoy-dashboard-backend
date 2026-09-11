-- Adding creators and assigning them to campaigns.
--
-- SECTION 1 only matters if the earlier version of this template was already
-- run and put the example names in. If it was not, skip to SECTION 2.

-- ---------------------------------------------------------------------
-- SECTION 1: remove the example creators, if they were loaded
-- ---------------------------------------------------------------------
-- Check first. If a creative is already linked to one of these, that link
-- is what you would lose.
select cr.name,
       (select count(*) from creatives c where c.creator_id = cr.id) as creatives_linked,
       (select count(*) from campaign_creators cc where cc.creator_id = cr.id) as campaign_assignments
  from creators cr
 where lower(cr.name) in ('shanudrie priyasad','romaine willis','prathiba hettiarachchi',
                          'rayini charuka','ashanthi de alwis','yohani')
 order by cr.name;

-- Unlink before deleting so no creative is removed, only the link.
update creatives set creator_id = null
 where creator_id in (select id from creators
                       where lower(name) in ('shanudrie priyasad','romaine willis',
                                             'prathiba hettiarachchi','rayini charuka',
                                             'ashanthi de alwis','yohani'));

-- creator_profiles and campaign_creators cascade from this.
delete from creators
 where lower(name) in ('shanudrie priyasad','romaine willis','prathiba hettiarachchi',
                       'rayini charuka','ashanthi de alwis','yohani');

-- ---------------------------------------------------------------------
-- SECTION 2: add your creators
--
-- One row per creator per platform. Leave a platform out if they are not on
-- it. Safe to re-run: an existing creator is matched on name and their
-- profiles updated rather than duplicated.
-- ---------------------------------------------------------------------
with input(name, platform, handle, profile_url) as (values
  -- name          platform   handle       profile url
  ('REPLACE ME',   'ig',      '@handle',   'https://www.instagram.com/handle/')
  -- ,('Second Creator', 'ig', '@handle', 'https://www.instagram.com/handle/')
  -- ,('Second Creator', 'tt', '@handle', 'https://www.tiktok.com/@handle')
),
upsert_creators as (
  insert into creators (name)
  select distinct name from input
  on conflict (lower(name)) do update set is_active = true
  returning id, name
),
all_creators as (
  select id, name from upsert_creators
  union
  select c.id, c.name from creators c
   where lower(c.name) in (select lower(name) from input)
)
insert into creator_profiles (creator_id, platform, handle, profile_url)
select ac.id, i.platform, i.handle, i.profile_url
  from input i
  join all_creators ac on lower(ac.name) = lower(i.name)
on conflict (creator_id, platform) do update
  set handle = excluded.handle, profile_url = excluded.profile_url;

-- ---------------------------------------------------------------------
-- SECTION 3: assign creators to a campaign
--
-- Change the brand, the campaign name and the creator list. Running this
-- again for another campaign reuses the same creators rather than creating
-- new ones.
-- ---------------------------------------------------------------------
insert into campaign_creators (campaign_id, creator_id)
select cp.id, cr.id
  from campaigns cp
  join creators  cr on lower(cr.name) in (
        lower('REPLACE ME')
        -- , lower('Second Creator')
      )
 where cp.brand_id = 'REPLACE_BRAND'
   and cp.name     = 'REPLACE CAMPAIGN NAME'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- SECTION 4: check
-- ---------------------------------------------------------------------
select cr.name as creator,
       string_agg(p.platform || ' ' || coalesce(p.handle, ''), ', ' order by p.platform) as profiles
  from creators cr
  left join creator_profiles p on p.creator_id = cr.id
 group by cr.name
 order by cr.name;

select cp.brand_id, cp.name as campaign, cr.name as creator
  from campaign_creators cc
  join campaigns cp on cp.id = cc.campaign_id
  join creators  cr on cr.id = cc.creator_id
 order by cp.brand_id, cp.name, cr.name;
