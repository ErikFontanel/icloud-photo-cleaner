import { toast } from "sonner";
import { AlbumsField } from "@/components/meta/albums-field";
import { type SetPlace, SpotRow } from "@/components/meta/spot-row";
import { SubmitField } from "@/components/meta/submit-field";
import { TagsField } from "@/components/meta/tags-field";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { albumsOf } from "@/lib/albums";
import type { EditState, Spot } from "@/lib/api";
import { counts, placeText, plural } from "@/lib/format";

export type Edit = (path: string, body: object) => Promise<unknown>;
export type MetaState = Pick<EditState, "names" | "tags" | "people" | "albums" | "album_adds" | "album_removes" | "tag_index" | "album_index">;

type Props = {
  uuids: string[]; // the photos these fields change
  st: MetaState;
  edit: Edit;
  eventName?: string; // the event's album, listed with the others when withEventAlbum
  withEventAlbum?: boolean;
  spots?: Spot[] | null; // places of the photos without GPS; null while asked
  listSpots?: boolean; // false where the places are shown elsewhere (they head the event's strips)
  ids?: { place?: string; tag?: string; album?: string }; // the table focuses these with L, T and A
  blurOnSubmit?: boolean;
};

// Saves a place, then says which one it found: Apple Maps or GeoNames may name it differently from what you typed.
export const placeSetter =
  (edit: Edit, spots?: Spot[] | null): SetPlace =>
  async (us, city, country = "") => {
    const r = (await edit("/api/table/place", { uuids: us, city, country })) as { place?: { city: string; country: string } | null } | undefined;
    const gps = spots ? us.filter((u) => !spots.some((g) => g.uuids.includes(u))).length : 0;
    const keep = gps ? ` ${plural(gps, "photo")} with a location of their own keep${gps === 1 ? "s" : ""} it.` : "";
    if (r?.place) toast.success(`Place set to ${r.place.city}, ${r.place.country} for ${plural(us.length - gps, "photo")}.${keep}`);
    else if (!city) toast(`Place cleared for ${plural(us.length, "photo")}.`);
  };

// Place, tags, people and albums of one or more photos: the same fields in an event row, the large photo and the table.
export function PhotoMeta({ uuids, st, edit, eventName, withEventAlbum, spots, listSpots = true, ids = {}, blurOnSubmit }: Props) {
  const n = uuids.length;
  const setPlace = placeSetter(edit, spots);
  const albums = albumsOf(st, uuids, eventName).filter((a) => withEventAlbum || a.kind !== "event");
  // The field shows the place the photos share once it is set; empty when they differ or have none yet.
  const texts = new Set(spots?.map((g) => (g.set ? placeText(g) : "")));
  const current = texts.size === 1 ? [...texts][0] : "";
  // Photos with a location of their own (GPS, or a pin an earlier Apply wrote) never get another: nothing to set.
  const allGps = !!spots && spots.length === 0;
  const people = counts(uuids, st.people);
  return (
    <FieldGroup className="gap-4">
      <Field className="gap-2">
        <FieldLabel htmlFor={ids.place}>Place</FieldLabel>
        {spots === null && <Spinner className="text-muted-foreground" />}
        {listSpots && spots?.map((g) => <SpotRow key={`${g.city}|${g.uuids[0]}`} spot={g} onSet={setPlace} />)}
        <SubmitField
          key={uuids.join()} // other photos: the field starts again from theirs
          id={ids.place}
          label="Place for the selected photos"
          placeholder={
            allGps
              ? n === 1
                ? "Has its own location (GPS or an earlier pin)"
                : "Every photo has its own location"
              : n > 1
                ? `Place for the ${n}: city, coordinates or map link`
                : "City, coordinates or map link"
          }
          disabled={allGps}
          initial={current}
          onSubmit={(v) => setPlace(uuids, v)}
          blurOnSubmit={blurOnSubmit}
        />
      </Field>
      <Field className="gap-2">
        <FieldLabel htmlFor={ids.tag}>Tags</FieldLabel>
        <TagsField
          tags={counts(uuids, st.tags)}
          of={n}
          index={st.tag_index}
          inputId={ids.tag}
          blurOnSubmit={blurOnSubmit}
          onEdit={(add, remove) => edit("/api/table/tags", { uuids, add, remove })}
        />
      </Field>
      {people.length > 0 && ( // read-only: Photos has no API to add people
        <Field className="gap-2">
          <FieldLabel>People</FieldLabel>
          <div className="flex flex-wrap gap-1">
            {people.map(([name, k]) => (
              <Badge key={name} variant="secondary">
                {name}
                {k !== n && (
                  <span className="text-muted-foreground">
                    · {k} of {n}
                  </span>
                )}
              </Badge>
            ))}
          </div>
        </Field>
      )}
      <Field className="gap-2">
        <FieldLabel htmlFor={ids.album}>Albums</FieldLabel>
        <AlbumsField
          albums={albums}
          of={n}
          index={st.album_index}
          inputId={ids.album}
          blurOnSubmit={blurOnSubmit}
          onEdit={(album, remove) => edit("/api/table/album", { uuids, album, remove })}
        />
      </Field>
    </FieldGroup>
  );
}

// The event's name: it becomes the album name on Apply. A suggestion is filled in until you name it.
export function EventName({
  name,
  label,
  onSave,
  id,
  blurOnSubmit,
}: {
  name?: string;
  label?: string;
  onSave: (v: string) => Promise<unknown>;
  id?: string;
  blurOnSubmit?: boolean;
}) {
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>Event name</FieldLabel>
      <SubmitField
        id={id}
        label="Event name"
        placeholder="Name it: becomes an album"
        initial={name || ""}
        suggest={label}
        onSubmit={onSave}
        blurOnSubmit={blurOnSubmit}
      />
    </Field>
  );
}
